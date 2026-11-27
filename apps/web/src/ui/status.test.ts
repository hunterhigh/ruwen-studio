import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusCopy } from "../copy/zh-CN.ts";
import { cleanErrorText, displayError } from "./error-text.ts";
import { observeSlowLoad } from "./slow-load.ts";

describe("inline notice text", () => {
  it("keeps localized actionable text", () => {
    expect(cleanErrorText("  资料读取失败，请刷新重试。  ")).toBe(
      "资料读取失败，请刷新重试。",
    );
    expect(displayError("INPUT_LIMIT_EXCEEDED")).toBe(
      "内容超过长度上限，请缩短后发送。",
    );
  });

  it.each([
    "ERR_UPSTREAM",
    "内容不可读：TypeError",
    "无法读取 C:\\private\\draft.md",
    "读取失败：资料/原稿.md",
    "读取失败：原稿.md",
    "连接失败\n在第一层",
    "异常：<pre>内部数据</pre>",
    " ",
  ])("replaces technical text %s", (text) => {
    expect(cleanErrorText(text)).toBe(statusCopy.genericError);
  });

  it("does not read inherited error codes", () => {
    expect(displayError("constructor")).toBe(statusCopy.genericError);
  });
});

describe("slow skeleton timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows once after ten seconds", () => {
    const show = vi.fn();
    const stop = observeSlowLoad(globalThis, show);
    vi.advanceTimersByTime(9_999);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(show).toHaveBeenCalledTimes(1);
    stop();
  });

  it("clears its pending timer when loading ends or the page unmounts", () => {
    const show = vi.fn();
    const stop = observeSlowLoad(globalThis, show);
    vi.advanceTimersByTime(5_000);
    stop();
    vi.advanceTimersByTime(20_000);
    expect(show).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
