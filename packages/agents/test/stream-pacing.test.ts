import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { forwardStream } from "../src/runtime/stream.ts";

const timing = vi.hoisted(() => ({ now: 0 }));
vi.mock("node:timers/promises", () => ({
  setTimeout: async (ms: number) => {
    timing.now += Math.ceil(ms / 16) * 16;
  },
}));
it("coarse OS timers preserve configured average pacing without multiplying the delay per Unicode character", async () => {
  vi.spyOn(performance, "now").mockImplementation(() => timing.now);
  const text = "甲乙丙丁戊己庚辛壬癸🌿",
    message = fauxAssistantMessage(text),
    source = createAssistantMessageEventStream();
  source.push({
    type: "text_delta",
    contentIndex: 0,
    delta: text,
    partial: message,
  });
  source.push({ type: "done", reason: "stop", message });
  source.end(message);
  const stream = forwardStream(source, { characterDelayMs: 2 });
  const chars: string[] = [];
  for await (const event of stream)
    if (event.type === "text_delta") chars.push(event.delta);
  expect(chars).toEqual(Array.from(text));
  expect(await stream.result()).toEqual(message);
  // Simulate Windows rounding waits up to 16ms: oversleep may cost one tick, not one tick per character.
  expect(timing.now).toBeLessThanOrEqual(Array.from(text).length * 2 + 16);
});
