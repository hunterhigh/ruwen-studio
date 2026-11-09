import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { assemblePrompt, ROLE_IDS, ROLES } from "../src/index.ts";
import {
  AUTHOR_SECURITY_NOTE,
  COORDINATOR_SECURITY_NOTE,
  deploymentCanary,
  GENERAL_SECURITY_NOTE,
  securityNote,
} from "../src/security/notes.ts";

it("the three templates are byte-for-byte the approved section 3.2 code blocks", async () => {
  const document = (
    await readFile(
      new URL("../../../docs/security/SECURITY-DESIGN.md", import.meta.url),
      "utf8",
    )
  ).replace(/\r\n/g, "\n");
  const section = document.split("### 3.2 ")[1]?.split("### 3.3 ")[0] ?? "";
  const blocks = [...section.matchAll(/```\n([\s\S]*?)\n```/g)].map(
    (match) => `${match[1]}\n`,
  );
  expect(blocks).toEqual([
    GENERAL_SECURITY_NOTE,
    AUTHOR_SECURITY_NOTE,
    COORDINATOR_SECURITY_NOTE,
  ]);
});
it.each(
  ROLE_IDS,
)("%s appends the exact correct note and includes its deployment marker only in the system prompt", async (id) => {
  const prompt = await assemblePrompt(ROLES[id]);
  expect(prompt.content.endsWith(securityNote(id))).toBe(true);
  expect(prompt.sha256).toBe(
    createHash("sha256").update(prompt.content).digest("hex"),
  );
  expect(prompt.content).toContain(deploymentCanary());
  if (id === "xiaoshuo-zuozhe")
    expect(prompt.content).not.toContain("本对话只服务于当前小说项目");
  else if (id === "chuangyi-xietiaoyuan")
    expect(prompt.content).toContain(COORDINATOR_SECURITY_NOTE);
  else expect(prompt.content).not.toContain(COORDINATOR_SECURITY_NOTE);
});
it("missing/invalid canaries fail clearly, do not disclose environment values, and a marker rotation changes the prompt hash", async () => {
  expect(() => deploymentCanary({})).toThrow("RUWEN_CANARY");
  expect(() => deploymentCanary({ RUWEN_CANARY: "\nINVALID_SECRET" })).toThrow(
    "configured random marker",
  );
  const before = await assemblePrompt(ROLES["qinggan-duzhe"]);
  vi.stubEnv("RUWEN_CANARY", "RUWEN_TEST_ROTATED_CANARY_c239fb44");
  try {
    expect((await assemblePrompt(ROLES["qinggan-duzhe"])).sha256).not.toBe(
      before.sha256,
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
