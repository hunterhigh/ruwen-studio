import {
  type AssistantMessage,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";

/** A local transcript fixture, not a provider. Used only by the offline smoke planner. */
export function localResponse(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    const reason = message.stopReason;
    if (
      reason === "stop" ||
      reason === "length" ||
      reason === "toolUse" ||
      reason === "deferred"
    )
      stream.push({ type: "done", reason, message });
    else
      stream.push({
        type: "error",
        reason: reason === "aborted" ? "aborted" : "error",
        error: message,
      });
    stream.end(message);
  });
  return stream;
}
