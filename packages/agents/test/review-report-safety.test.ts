import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { assemblePrompt, ROLES } from "../src/index.ts";

it("the developer report CLI emits only metadata, never deployment canaries or a 30-character prompt excerpt", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ruwen-review-safe-"));
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith("ruwen-review-safe-")
  )
    throw new Error("Unsafe report cleanup");
  try {
    const stdout = execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../scripts/report-review-prompts.ts", import.meta.url),
        ),
        "--output",
        directory,
      ],
      {
        encoding: "utf8",
        env: { ...process.env },
        timeout: 20000,
        windowsHide: true,
      },
    );
    const outputs = [stdout];
    for (const file of await readdir(directory))
      outputs.push(await readFile(path.join(directory, file), "utf8"));
    for (const body of outputs)
      expect(body).not.toContain(process.env.RUWEN_CANARY);
    for (const id of [
      "xiaoshuo-zuozhe",
      "qinggan-duzhe",
      "wenxue-bianji",
    ] as const) {
      const prompt = (await assemblePrompt(ROLES[id])).content;
      const chars = Array.from(prompt);
      const body = outputs.join("\n");
      for (let i = 0; i + 30 <= chars.length; i++)
        expect(body).not.toContain(chars.slice(i, i + 30).join(""));
    }
  } finally {
    await rm(resolved, { recursive: true, force: true });
  }
});
