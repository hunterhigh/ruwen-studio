import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeDecisionPolling } from "./useProjectDecisions.ts";

function polling(initial: DocumentVisibilityState = "visible") {
  const screen = Object.assign(new EventTarget(), { visibilityState: initial });
  const browser = Object.assign(new EventTarget(), {
    setInterval: (callback: () => void, ms: number) =>
      Number(setInterval(callback, ms)),
    clearInterval: (id: number) => clearInterval(id),
  });
  let reading = false;
  const refresh = vi.fn();
  const stop = observeDecisionPolling(screen, browser, refresh, () => reading);
  return {
    refresh,
    stop,
    browser,
    setReading(value: boolean) {
      reading = value;
    },
    visibility(value: DocumentVisibilityState) {
      screen.visibilityState = value;
      screen.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("project decision polling", () => {
  it("reads every 60 seconds while visible and never overlaps a scheduled read", () => {
    const { refresh, setReading, stop } = polling();
    vi.advanceTimersByTime(59_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    setReading(true);
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    setReading(false);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops the timer in the background and reads immediately once on return", () => {
    const { refresh, visibility, setReading, browser, stop } = polling();
    vi.advanceTimersByTime(25_000);
    visibility("hidden");
    browser.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
    setReading(true);
    visibility("visible");
    visibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    setReading(false);
    vi.advanceTimersByTime(59_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("can mount hidden and releases visibility and focus listeners on cleanup", () => {
    const { refresh, visibility, stop, browser } = polling("hidden");
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    visibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    visibility("hidden");
    visibility("visible");
    browser.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
