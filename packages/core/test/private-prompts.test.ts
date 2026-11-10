import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  exportProjectZip,
  importProjectZip,
  LocalDirFS,
  migrateProjectPrompts,
  publicRoleResult,
} from "../src/index.ts";
import { temporaryProject } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
const secret =
  "TEST_ONLY_PRIVATE_PROMPT_CANARY_67ef_内部系统提示词只应保存在平台数据库中，不可由项目访问。";
const hash = createHash("sha256").update(secret).digest("hex");
const report = "authoring-ruwen-v5/reports/runs/example/qinggan-duzhe.json";
const legacy = `authoring-ruwen-v5/reports/prompts/${hash}.txt`;
const value = {
  output: { reactions: [] },
  promptSha256: hash,
  systemPrompt: secret,
  transcript: [
    { role: "system", content: secret },
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "PRIVATE_THINKING_TEST_593",
          thinkingSignature: "PRIVATE_SIGNATURE_TEST_593",
        },
        { type: "text", text: "可见文字" },
      ],
    },
  ],
};
async function project() {
  const p = await temporaryProject();
  cleanups.push(p.cleanup);
  return p.fs;
}

it("moves local legacy copies before deleting them; repeated migration is harmless and ZIP contains no private bytes", async () => {
  const fs = await project();
  await fs.write(legacy, secret);
  await fs.write(report, JSON.stringify(value));
  const saved = new Map<string, string>();
  expect(
    await migrateProjectPrompts(fs, async (key, content) => {
      saved.set(key, content);
    }),
  ).toEqual({ prompts: 1, artifacts: 2 });
  expect(saved.get(hash)).toBe(secret);
  expect(await fs.exists(legacy)).toBe(false);
  expect(JSON.parse(await fs.readText(report))).toEqual(
    publicRoleResult(value),
  );
  expect(
    await migrateProjectPrompts(fs, async () => {
      throw new Error("must not save twice");
    }),
  ).toEqual({ prompts: 0, artifacts: 0 });
  const restored = new LocalDirFS(`${(await project()).root}-import`);
  await importProjectZip(restored, await exportProjectZip(fs));
  for (const p of await restored.list()) {
    const body = await restored.readText(p);
    expect(body).not.toContain("PRIVATE_THINKING_TEST_593");
    expect(body).not.toContain("PRIVATE_SIGNATURE_TEST_593");
    expect(body).not.toContain(secret);
    for (let n = 0; n <= Array.from(secret).length - 30; n++)
      expect(body).not.toContain(
        Array.from(secret)
          .slice(n, n + 30)
          .join(""),
      );
  }
});
it("rejects a thinking-only legacy report at export until the explicit migration strips it", async () => {
  const fs = await project();
  const cleanSystem = {
    promptSha256: hash,
    output: "可见输出",
    transcript: value.transcript.filter((message) => message.role !== "system"),
  };
  await fs.write(report, JSON.stringify(cleanSystem));
  await expect(exportProjectZip(fs)).rejects.toThrow("private role artifact");
  await migrateProjectPrompts(fs, async () => {
    throw new Error("No system prompt to capture");
  });
  expect(await fs.readText(report)).not.toContain("PRIVATE_THINKING_TEST_593");
  await expect(exportProjectZip(fs)).resolves.toBeInstanceOf(Uint8Array);
});
it("a failed platform store leaves every local legacy byte intact", async () => {
  const fs = await project();
  await fs.write(legacy, secret);
  await fs.write(report, JSON.stringify(value));
  await expect(
    migrateProjectPrompts(fs, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(await fs.readText(legacy)).toBe(secret);
  expect(await fs.readText(report)).toBe(JSON.stringify(value));
});
it("archives refuse residual private artifacts rather than silently exporting them", async () => {
  const fs = await project();
  await fs.write(report, JSON.stringify(value));
  await expect(exportProjectZip(fs)).rejects.toThrow("private role artifact");
  await fs.remove(report);
  await fs.write(legacy, secret);
  await expect(exportProjectZip(fs)).rejects.toThrow("legacy private prompts");
});
