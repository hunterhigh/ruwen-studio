import { setTimeout as delay } from "node:timers/promises";
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
/** Forward provider events, optionally publishing prose one Unicode character at a time. */
export function forwardStream(
  source: AssistantMessageEventStream,
  options: {
    signal?: AbortSignal | undefined;
    characterDelayMs?: number;
    finalMessage?: AssistantMessage;
    finish?: (message: AssistantMessage) => Promise<void>;
  },
) {
  const output = createAssistantMessageEventStream();
  void (async () => {
    try {
      for await (const event of source) {
        if (event.type === "done" || event.type === "error") {
          const message = options.finalMessage
            ? structuredClone(options.finalMessage)
            : event.type === "done"
              ? event.message
              : event.error;
          await options.finish?.(message);
          if (event.type === "done") output.push({ ...event, message });
          else output.push({ ...event, error: message });
        } else if (
          event.type === "text_delta" &&
          options.characterDelayMs !== undefined
        ) {
          for (const char of event.delta) {
            options.signal?.throwIfAborted();
            if (options.characterDelayMs > 0)
              await delay(options.characterDelayMs, undefined, {
                signal: options.signal,
              });
            output.push({ ...event, delta: char });
          }
        } else output.push(event);
      }
      output.end(options.finalMessage ?? (await source.result()));
    } catch (error) {
      const partial = structuredClone(await source.result());
      partial.stopReason = options.signal?.aborted ? "aborted" : "error";
      partial.errorMessage = (error as Error).message;
      output.push({
        type: "error",
        reason: partial.stopReason,
        error: partial,
      });
      output.end(partial);
    }
  })();
  return output;
}
