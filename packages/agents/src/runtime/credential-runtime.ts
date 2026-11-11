import {
  type AssistantMessage,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../types.ts";
import {
  assertModelCredentialFiles,
  ModelCredentialError,
  processModelKey,
  processModelSecrets,
  redactModelValue,
} from "./model-credentials.ts";

/** Explicit key injection prevents SDK credential-file discovery and caller credential overrides. */
export function environmentCredentials(base: ModelRuntime): ModelRuntime {
  assertModelCredentialFiles();
  const stream: ModelRuntime["models"]["streamSimple"] = (
    model,
    context,
    options,
  ) => {
    const key = processModelKey(model.provider),
      secrets = processModelSecrets();
    if (
      (options?.apiKey !== undefined && options.apiKey !== key) ||
      options?.env ||
      Object.keys(options?.headers ?? {}).some((k) =>
        /^(authorization|x-api-key|api-key)$/i.test(k),
      )
    )
      throw new ModelCredentialError(
        "Model credential overrides are forbidden; use process environment variables only.",
      );
    let source: ReturnType<typeof base.models.streamSimple>;
    try {
      source = base.models.streamSimple(model, context, {
        ...options,
        apiKey: key,
      });
    } catch (error) {
      throw new ModelCredentialError(
        redactModelValue(
          error instanceof Error ? error.message : String(error),
          secrets,
        ),
      );
    }
    const output = createAssistantMessageEventStream();
    void (async () => {
      let pending = "",
        contentIndex = 0;
      let last: AssistantMessage | undefined;
      try {
        for await (const event of source) {
          const safe = redactModelValue(event, secrets);
          if (event.type === "text_delta") {
            contentIndex = event.contentIndex;
            const text = pending + event.delta;
            const clean = redactModelValue(text, secrets);
            let hold = 0;
            for (const secret of secrets)
              for (
                let n = Math.min(secret.length - 1, clean.length);
                n > hold;
                n--
              )
                if (clean.endsWith(secret.slice(0, n))) {
                  hold = n;
                  break;
                }
            pending = clean.slice(clean.length - hold);
            const delta = clean.slice(0, clean.length - hold);
            if (delta)
              output.push({ ...redactModelValue(event, secrets), delta });
          } else {
            if (event.type === "done" || event.type === "error") {
              if (pending)
                output.push({
                  type: "text_delta",
                  contentIndex,
                  delta: redactModelValue(pending, secrets),
                  partial: redactModelValue(
                    event.type === "done" ? event.message : event.error,
                    secrets,
                  ),
                });
              pending = "";
            }
            if (event.type === "done")
              last = redactModelValue(event.message, secrets);
            if (event.type === "error")
              last = redactModelValue(event.error, secrets);
            output.push(safe);
          }
        }
        output.end(redactModelValue(await source.result(), secrets));
      } catch (error) {
        const message: AssistantMessage = {
          ...(last ?? {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            timestamp: Date.now(),
          }),
          stopReason: "error",
          errorMessage: redactModelValue(
            error instanceof Error ? error.message : String(error),
            secrets,
          ),
        };
        output.push({ type: "error", reason: "error", error: message });
        output.end(message);
      }
    })();
    return output;
  };
  const models = new Proxy(base.models, {
    get(target, k) {
      if (k === "streamSimple") return stream;
      if (
        [
          "stream",
          "complete",
          "completeSimple",
          "streamDeferred",
          "fetchDeferred",
        ].includes(String(k))
      )
        return () => {
          throw new ModelCredentialError(
            "Live runtime permits only credential-guarded streamSimple",
          );
        };
      const value = Reflect.get(target, k);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...base, models, apiKey: processModelKey };
}
