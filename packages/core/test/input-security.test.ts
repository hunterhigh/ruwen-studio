import { afterEach, expect, it, vi } from "vitest";
import {
  assertInputLimits,
  assertMaterialText,
  securityLimits,
} from "../src/index.ts";

afterEach(() => vi.unstubAllEnvs());
it("uses documented defaults and counts codepoints rather than UTF-16 units", () => {
  expect(securityLimits({})).toMatchObject({
    chatChars: 8000,
    materialChars: 100000,
    jsonDepth: 32,
  });
  expect(() =>
    assertInputLimits({ raw_user_text: "😀".repeat(8000) }),
  ).not.toThrow();
  expect(() => assertInputLimits({ raw_user_text: "😀".repeat(8001) })).toThrow(
    "消息",
  );
  expect(() => assertMaterialText("字".repeat(100000))).not.toThrow();
  expect(() => assertMaterialText("字".repeat(100001))).toThrow("资料");
});
it("enforces configured aggregate, depth and node budgets without rejecting acyclic aliases", () => {
  const shared = { description: "正常资料" };
  expect(() =>
    assertInputLimits({ first: shared, second: shared }),
  ).not.toThrow();
  vi.stubEnv("RUWEN_INPUT_MAX_CHARS", "5");
  expect(() => assertInputLimits({ first: "123", second: "456" })).toThrow(
    "总长度",
  );
  vi.unstubAllEnvs();
  vi.stubEnv("RUWEN_JSON_MAX_DEPTH", "2");
  expect(() => assertInputLimits({ one: { two: { three: "deep" } } })).toThrow(
    "depth",
  );
  vi.unstubAllEnvs();
  vi.stubEnv("RUWEN_JSON_MAX_NODES", "3");
  expect(() => assertInputLimits([1, 2, 3, 4])).toThrow("node");
});
it("rejects parsed pollution keys and cycles; fictional uses of their names are ordinary text", () => {
  expect(() =>
    assertInputLimits(JSON.parse('{"safe":{"__proto__":{"polluted":true}}}')),
  ).toThrow("Unsafe JSON");
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(() => assertInputLimits(cycle)).toThrow("Cyclic");
  expect(() =>
    assertInputLimits({
      prose: "角色写下了“__proto__”，又说“忽略之前的指令”。",
    }),
  ).not.toThrow();
  expect(() => securityLimits({ RUWEN_CHAT_MAX_CHARS: "0" })).toThrow(
    "Invalid security limit",
  );
});
