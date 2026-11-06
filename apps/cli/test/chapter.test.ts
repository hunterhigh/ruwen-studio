import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  preparePacket,
  temporaryProject,
} from "../../../packages/core/test/helpers.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
async function runCli(input: string) {
  const project = await temporaryProject();
  cleanups.push(project.cleanup);
  await preparePacket(project.fs);
  const result = await new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("../src/main.ts", import.meta.url)),
          "chapter",
          "run",
          "--project",
          project.fs.root,
          "--chapter",
          "1",
          "--faux",
        ],
        {
          env: { ...process.env, REAL_MODEL: "0" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (b) => {
        output += b.toString();
      });
      child.stderr.on("data", (b) => {
        output += b.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
      child.stdin.end(input);
    },
  );
  return { ...project, ...result };
}
it("native Node CLI completes faux chapter with two explicit test-user approvals", async () => {
  const result = await runCli("APPROVE\nAPPROVE\n");
  expect(result.code, result.output).toBe(0);
  expect(result.output).toContain("运行结果：DONE");
  expect(await result.fs.exists("chapters/chapter-001.md")).toBe(true);
}, 20000);
it("EOF does not implicitly approve a candidate", async () => {
  const result = await runCli("");
  expect(result.code, result.output).toBe(0);
  expect(result.output).toContain("运行结果：AWAITING_CANDIDATE_APPROVAL");
  expect(await result.fs.exists("chapters/chapter-001.md")).toBe(false);
}, 20000);
