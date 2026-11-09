import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  assemblePrompt,
  ROLE_IDS,
  ROLES,
} from "../packages/agents/src/index.ts";

const { values } = parseArgs({ options: { output: { type: "string" } } });
const directory = values.output
  ? pathToFileURL(`${path.resolve(values.output)}${path.sep}`)
  : new URL("../docs/reports/review-prompt-examples/", import.meta.url);
await mkdir(directory, { recursive: true });
const examples = new Set(["xiaoshuo-zuozhe", "qinggan-duzhe", "wenxue-bianji"]);
const roles = [];
for (const id of ROLE_IDS) {
  const prompt = await assemblePrompt(ROLES[id]);
  roles.push({
    id,
    characters: Array.from(prompt.content).length,
    utf8Bytes: Buffer.byteLength(prompt.content),
    sha256: prompt.sha256,
  });
  if (examples.has(id))
    await writeFile(
      new URL(`${id}.system.txt`, directory),
      `${JSON.stringify({ id, sha256: prompt.sha256, characters: Array.from(prompt.content).length, utf8Bytes: Buffer.byteLength(prompt.content), note: "安全审阅仅保留哈希与长度；不生成系统提示词全文。" }, null, 2)}\n`,
      "utf8",
    );
}
const upstreamCommit = execFileSync("git", ["rev-parse", "HEAD:vendor/ruwen"], {
  cwd: new URL("../", import.meta.url),
  encoding: "utf8",
}).trim();
await writeFile(
  new URL("counts.json", directory),
  `${JSON.stringify({ upstreamCommit, unit: "Unicode code points, including whitespace; LF normalized upstream", roles }, null, 2)}\n`,
);
console.log(JSON.stringify(roles, null, 2));
