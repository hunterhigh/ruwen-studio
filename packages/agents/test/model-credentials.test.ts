import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { createFauxRuntime, ROLES } from "../src/index.ts";
import { environmentCredentials } from "../src/runtime/credential-runtime.ts";
import { createApplicationRuntime } from "../src/runtime/index.ts";
import {
  assertModelCredentialFiles,
  loadRuntimeEnvironment,
  processModelKey,
  redactModelValue,
} from "../src/runtime/model-credentials.ts";

const FAKE = "FAKE_MODEL_CREDENTIAL_FOR_TESTS_ONLY_48f082dca9";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const stop of cleanup.splice(0)) await stop();
});
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), "ruwen-model-env-"));
  cleanup.push(async () => {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("ruwen-model-env-")
    )
      throw new Error("Unsafe cleanup");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
it.each([
  ".env",
  ".env.local",
  ".env.production.local",
])("refuses %s without exposing a file credential, even when skip-file is enabled", async (name) => {
  const root = await folder();
  await writeFile(path.join(root, name), `DEEPSEEK_API_KEY="${FAKE}"\n`);
  let error: unknown;
  try {
    loadRuntimeEnvironment({ root, skipFile: true });
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("process environment");
  expect(String((error as Error).stack)).not.toContain(FAKE);
});
it("loads non-model settings without loading blank model-key placeholders or replacing parent values", async () => {
  const root = await folder();
  await writeFile(
    path.join(root, ".env"),
    "MODEL_CREDENTIAL_TEST_SETTING=file\nDEEPSEEK_API_KEY=\n",
  );
  vi.stubEnv("MODEL_CREDENTIAL_TEST_SETTING", "parent");
  vi.stubEnv("DEEPSEEK_API_KEY", FAKE);
  loadRuntimeEnvironment({ root });
  expect(process.env.MODEL_CREDENTIAL_TEST_SETTING).toBe("parent");
  expect(processModelKey("deepseek")).toBe(FAKE);
});
it("refuses routing JSON credentials and credential-file indirection", async () => {
  const root = await folder();
  await mkdir(path.join(root, "config"));
  await writeFile(
    path.join(root, "config/models.deepseek.json"),
    JSON.stringify({ apiKey: FAKE }),
  );
  expect(() => assertModelCredentialFiles(root)).toThrow("process environment");
  await rm(path.join(root, "config/models.deepseek.json"));
  vi.stubEnv("DEEPSEEK_API_KEY_FILE", "not-read-secret.txt");
  expect(() => assertModelCredentialFiles(root)).toThrow("process environment");
});
it("injects only environment credentials, rejects overrides, and redacts split deltas, final replies and native failures before consumers", async () => {
  vi.stubEnv("OPENAI_API_KEY", FAKE);
  const source = createFauxRuntime(),
    model = {
      ...source.resolve(ROLES["xiaoshuo-zuozhe"]).model,
      provider: "openai",
    };
  const message = {
    ...fauxAssistantMessage(""),
    content: [{ type: "text" as const, text: `auth ${FAKE} failed` }],
    stopReason: "stop" as const,
  };
  const upstream = vi
    .spyOn(source.models, "streamSimple")
    .mockImplementation((_model, _context, options) => {
      expect(options?.apiKey).toBe(FAKE);
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: `auth ${FAKE.slice(0, 12)}`,
          partial: message,
        });
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: `${FAKE.slice(12)} failed`,
          partial: message,
        });
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      });
      return stream;
    });
  const runtime = environmentCredentials(source),
    context = { messages: [] };
  const stream = runtime.models.streamSimple(model, context);
  let text = "",
    events = "";
  for await (const e of stream) {
    events += JSON.stringify(e);
    if (e.type === "text_delta") text += e.delta;
  }
  expect(text).toBe("auth [REDACTED] failed");
  expect(events).not.toContain(FAKE);
  expect(JSON.stringify(await stream.result())).not.toContain(FAKE);
  expect(() =>
    runtime.models.streamSimple(model, context, {
      apiKey: "FILE_OVERRIDE_FOR_TEST",
    }),
  ).toThrow("overrides");
  expect(upstream).toHaveBeenCalledTimes(1);
  upstream.mockImplementation(() => {
    throw new Error(`native auth ${FAKE} failed`);
  });
  let error: unknown;
  try {
    runtime.models.streamSimple(model, context);
  } catch (e) {
    error = e;
  }
  expect(String((error as Error).stack)).not.toContain(FAKE);
  expect(String(error)).toContain("[REDACTED]");
});
it("records a guarded fake provider without any credential in request/response fixture bytes", async () => {
  const root = await folder();
  vi.stubEnv("OPENAI_API_KEY", FAKE);
  const source = createFauxRuntime(),
    model = {
      ...source.resolve(ROLES["xiaoshuo-zuozhe"]).model,
      provider: "openai",
    };
  source.models.streamSimple = () => {
    const stream = createAssistantMessageEventStream(),
      message = fauxAssistantMessage(`failure ${FAKE}`);
    queueMicrotask(() => {
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    });
    return stream;
  };
  const runtime = createApplicationRuntime({
    mode: "record",
    workspaceRoot: root,
    upstream: environmentCredentials(source),
  });
  await runtime.models
    .streamSimple(model, {
      messages: [
        { role: "system", content: "plain test system", timestamp: 0 },
        { role: "user", content: FAKE, timestamp: 0 },
      ],
    })
    .result();
  const io = await import("node:fs/promises"),
    directory = path.join(root, ".local/model-recordings");
  const files = await io.readdir(directory);
  expect(files).toHaveLength(1);
  expect(
    await io.readFile(path.join(directory, files[0] ?? ""), "utf8"),
  ).not.toContain(FAKE);
});
it("redacts complete report/recording structures and text-block joins while preserving thinking for internal protocol replay", () => {
  const result = redactModelValue(
    {
      output: FAKE,
      content: [
        { type: "text", text: FAKE.slice(0, 14) },
        { type: "text", text: FAKE.slice(14) },
        { type: "thinking", thinking: "private internal state" },
      ],
      error: { message: FAKE },
    },
    [FAKE],
  );
  expect(JSON.stringify(result)).not.toContain(FAKE);
  expect(
    result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(""),
  ).not.toContain(FAKE);
  expect(result.content.find((b) => b.type === "thinking")?.thinking).toBe(
    "private internal state",
  );
});
