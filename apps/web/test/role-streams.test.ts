import { expect, it } from "vitest";
import {
  applyRoleFrame,
  emptyRoleStreams,
  roleStreamText,
} from "../src/components/role-streams.ts";

it("reset isolates session/run/role, keeps saved state immutable and deduplicates replay with exact decimal cursors", () => {
  let state = emptyRoleStreams();
  const send = (
    sessionId: string,
    runId: string,
    role: string,
    id: string,
    text?: string,
  ) => {
    state = applyRoleFrame(state, {
      sessionId,
      runId,
      role,
      id,
      type: text === undefined ? "reset" : "delta",
      text,
    });
  };
  send("a", "r1", "coordinator", "9007199254740993", "旧尝试");
  send("a", "r2", "coordinator", "9007199254740994", "另一任务");
  send("a", "r1", "story", "9007199254740995", "另一岗位");
  send("b", "r1", "coordinator", "1", "另一会话");
  const before = state;
  send("a", "r1", "coordinator", "9007199254740996");
  expect(roleStreamText(state, "a", "r1", "coordinator")).toBe("");
  expect(roleStreamText(before, "a", "r1", "coordinator")).toBe("旧尝试");
  send("a", "r1", "coordinator", "9007199254740997", "更正后");
  send("a", "r1", "coordinator", "9007199254740996");
  send("a", "r1", "coordinator", "9007199254740997", "更正后");
  expect(roleStreamText(state, "a", "r1", "coordinator")).toBe("更正后");
  expect(roleStreamText(state, "a", "r2", "coordinator")).toBe("另一任务");
  expect(roleStreamText(state, "a", "r1", "story")).toBe("另一岗位");
  expect(roleStreamText(state, "b", "r1", "coordinator")).toBe("另一会话");
});

it("keeps an initial reset and ignores malformed frames without advancing the cursor", () => {
  const frame = {
    sessionId: "a",
    runId: "r",
    role: "story",
    type: "reset" as const,
    id: "1",
  };
  const state = applyRoleFrame(emptyRoleStreams(), frame);
  expect(state.cursors.a).toBe("1");
  expect(applyRoleFrame(state, { ...frame, id: "no" })).toBe(state);
  expect(applyRoleFrame(state, { ...frame, type: "delta", id: "2" })).toBe(
    state,
  );
});
