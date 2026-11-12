import {
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { arr, obj, str } from "@earendil-works/pi-schema";
import { afterAll, beforeAll, expect, it } from "vitest";
import { temporaryProject } from "../../core/test/helpers.ts";
import {
  createFauxRuntime,
  type Data,
  fauxOutput,
  RoleOutputError,
  runRole,
} from "../src/index.ts";
import {
  type ToolValidationFailure,
  toolValidator,
} from "../src/tools/validation-feedback.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
beforeAll(async () => {
  project = await temporaryProject();
});
afterAll(async () => {
  await project.cleanup();
});
const input: Data = {
  raw_user_text: "讨论仍开放的人物关系。",
  project_state: { project: "test-project" },
};
function proposal(invalid: boolean) {
  const output = fauxOutput("chuangyi-xietiaoyuan", input) as Data;
  if (invalid)
    (output.payload as Data).open_realization = "保留动作与对白的选择";
  return fauxAssistantMessage(fauxToolCall("propose_handoff", output), {
    stopReason: "toolUse",
  });
}
it("returns the failed field and expected type, so one faux correction completes the handoff without coercion", async () => {
  const failures: ToolValidationFailure[] = [],
    requests: TranscriptContext[] = [],
    resets: string[] = [];
  const runtime = createFauxRuntime([
    proposal(true),
    (context) => {
      const errors = context.messages.filter((m) => m.role === "toolResult");
      expect(JSON.stringify(errors)).toContain(
        "/payload/open_realization: expected array, got string",
      );
      return proposal(false);
    },
  ]);
  runtime.onToolValidationError = (_role, failure) => failures.push(failure);
  const result = await runRole("chuangyi-xietiaoyuan", input, {
    fs: project.fs,
    projectKey: "test-project",
    runtime,
    onRequest: (r) => requests.push(r),
    onAttemptReset: (_role, reason) => resets.push(reason),
  });
  expect((result.output as Data).payload).toMatchObject({
    open_realization: expect.any(Array),
  });
  expect(runtime.faux.state.callCount).toBe(2);
  expect(resets).toEqual(["format_correction"]);
  expect(failures).toEqual([
    {
      tool: "propose_handoff",
      issues: [
        {
          path: "/payload/open_realization",
          keyword: "type",
          message: "expected array, got string",
        },
      ],
    },
  ]);
  expect(result.usage).toHaveLength(2);
  expect(JSON.stringify(requests[1])).toContain("上次输出未通过格式或内容校验");
});
it("still refuses two bad attempts and records the concrete failure while preserving usage and retry limits", async () => {
  const runtime = createFauxRuntime([
      proposal(true),
      proposal(true),
      proposal(false),
    ]),
    failures: ToolValidationFailure[] = [];
  runtime.onToolValidationError = (_role, failure) => failures.push(failure);
  let error: unknown;
  try {
    await runRole("chuangyi-xietiaoyuan", input, {
      fs: project.fs,
      projectKey: "test-project",
      runtime,
    });
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(RoleOutputError);
  expect((error as Error).message).toContain(
    "/payload/open_realization: expected array, got string",
  );
  expect((error as RoleOutputError).partial?.usage).toHaveLength(2);
  expect(runtime.faux.state.callCount).toBe(2);
  expect(failures).toHaveLength(2);
});
it("records a non-coercible schema failure even when the SDK rejects before beforeToolCall", async () => {
  const failures: ToolValidationFailure[] = [];
  const invalid = proposal(false);
  const block = invalid.content.find((b) => b.type === "toolCall");
  if (!block || block.type !== "toolCall") throw new Error("Missing proposal");
  (block.arguments.payload as Data).open_realization = [{}];
  const runtime = createFauxRuntime([invalid, invalid]);
  runtime.onToolValidationError = (_role, failure) => failures.push(failure);
  await expect(
    runRole("chuangyi-xietiaoyuan", input, {
      fs: project.fs,
      projectKey: "test-project",
      runtime,
    }),
  ).rejects.toBeInstanceOf(RoleOutputError);
  expect(failures).toHaveLength(2);
  expect(failures[0]?.issues).toContainEqual({
    path: "/payload/open_realization/0",
    keyword: "type",
    message: "expected string, got object",
  });
});
it("returns bounded schema metadata without copying argument values or unknown property names", () => {
  const validator = toolValidator(obj({ items: arr(str()) }));
  expect(validator.check({ items: "item" })).toBe(false);
  expect(
    validator.issues({ items: "item", "unrecognized-property": 123 }),
  ).toEqual([
    { path: "/items", keyword: "type", message: "expected array, got string" },
    {
      path: "/<unknown>",
      keyword: "additionalProperties",
      message: "unknown field",
    },
  ]);
});
