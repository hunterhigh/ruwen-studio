import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AssistantMessage,
  createFauxCore,
  type Models,
  type ModelsSimpleStreamOptions,
  normalizeContext,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../types.ts";
import { forwardStream } from "./stream.ts";

const ordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, ordered(item)]),
    );
  return value;
};
function safeOptions(options: ModelsSimpleStreamOptions = {}) {
  const {
    apiKey: _key,
    signal: _signal,
    headers: _headers,
    sessionId: _session,
    env: _env,
    ...remaining
  } = options;
  const result = JSON.parse(JSON.stringify(remaining)) as Record<
    string,
    unknown
  >;
  // Agent loop options also carry a duplicated model object with an ephemeral faux transport ID.
  delete result.model;
  return result;
}
/** Ignore transport-only timing, usage and random tool IDs while preserving all semantic content. */
export function stableRequestHash(
  model: { id: string; provider: string; api: string },
  context: TranscriptContext,
  options: ModelsSimpleStreamOptions = {},
) {
  const ids = new Map<string, string>();
  const id = (value: unknown) => {
    if (typeof value !== "string") return value;
    if (!ids.has(value)) ids.set(value, `tool-${ids.size}`);
    return ids.get(value);
  };
  const messages = JSON.parse(JSON.stringify(context.messages)) as Record<
    string,
    unknown
  >[];
  for (const message of messages) {
    for (const key of [
      "timestamp",
      "durationMs",
      "responseId",
      "usage",
      "api",
      "provider",
      "model",
    ])
      delete message[key];
    if (message.role === "toolResult")
      message.toolCallId = id(message.toolCallId);
    if (Array.isArray(message.content))
      for (const block of message.content)
        if (block && typeof block === "object" && block.type === "toolCall")
          block.id = id(block.id);
  }
  return createHash("sha256")
    .update(
      JSON.stringify(
        ordered({
          model: {
            id: model.id,
            provider: model.provider,
            api:
              model.provider === "faux" && model.api.startsWith("faux:")
                ? "faux"
                : model.api,
          },
          context: { ...context, messages },
          options: safeOptions(options),
        }),
      ),
    )
    .digest("hex");
}
interface Tape {
  version: 1;
  requestHash: string;
  request: {
    model: { id: string; provider: string; api: string };
    context: TranscriptContext;
    options: Record<string, unknown>;
  };
  response: AssistantMessage;
}
export function tapeRuntime(
  base: ModelRuntime,
  mode: "record" | "replay",
  workspaceRoot: string,
  characterDelayMs = 0,
): ModelRuntime {
  const directory = path.resolve(workspaceRoot, ".local/model-recordings");
  const upstream = base.models.streamSimple.bind(base.models);
  const stream: Models["streamSimple"] = (selected, rawContext, options) => {
    const context = normalizeContext(rawContext);
    const model = {
      id: selected.id,
      provider: selected.provider,
      api: selected.api,
    };
    const hash = stableRequestHash(model, context, options),
      file = path.join(directory, `${hash}.json`);
    if (mode === "replay") {
      const replay = createFauxCore({
        models: [{ id: selected.id, maxTokens: selected.maxTokens }],
        tokenSize: { min: 1, max: 1 },
      });
      let saved: AssistantMessage | undefined;
      replay.setResponses([
        async () => {
          const tape = JSON.parse(await readFile(file, "utf8")) as Tape;
          if (
            tape.version !== 1 ||
            tape.requestHash !== hash ||
            stableRequestHash(
              tape.request.model,
              tape.request.context,
              tape.request.options,
            ) !== hash ||
            !Array.isArray(tape.response?.content) ||
            !tape.response.usage
          )
            throw new Error(
              "Replay fixture is invalid or request hash differs",
            );
          saved = tape.response;
          return saved;
        },
      ]);
      // The provider schedules its factory in a microtask; defer forwarding until the saved response is loaded.
      const source = replay.streamSimple(selected, context, options);
      return forwardStream(source, {
        signal: options?.signal,
        characterDelayMs,
        finish: async (message) => {
          if (
            saved &&
            (message.stopReason !== "aborted" || saved.stopReason === "aborted")
          )
            Object.assign(message, structuredClone(saved));
        },
      });
    }
    const secret = options?.apiKey ?? base.apiKey?.(selected.provider);
    return forwardStream(upstream(selected, context, options), {
      signal: options?.signal,
      finish: async (response) => {
        const tape: Tape = {
          version: 1,
          requestHash: hash,
          request: { model, context, options: safeOptions(options) },
          response,
        };
        let content = JSON.stringify(tape, null, 2);
        if (secret) content = content.split(secret).join("[REDACTED]");
        await mkdir(directory, { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${content}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, file);
      },
    });
  };
  const models = new Proxy(base.models, {
    get(target, key) {
      if (key === "streamSimple") return stream;
      if (
        mode === "replay" &&
        [
          "stream",
          "complete",
          "completeSimple",
          "streamDeferred",
          "fetchDeferred",
        ].includes(String(key))
      )
        return () => {
          throw new Error(
            "Replay permits only recorded streamSimple requests; live fallback is disabled",
          );
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    ...base,
    mode,
    models,
    ...(mode === "replay" ? { apiKey: () => undefined } : {}),
  };
}
