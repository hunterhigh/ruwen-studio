import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, expect, inject, it } from "vitest";
import { Database } from "../src/index.ts";

const db = new Database(inject("databaseUrl"));
afterAll(() => db.close());
it("0003 atomically removes every old prompt copy, including file history and system messages, and preserves unrelated bytes", async () => {
  const client = await db.pool.connect();
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  const secret =
    "TEST_ONLY_MIGRATION_CANARY_0942_完整平台系统原文不能进入用户导出或历史文件。";
  const hash = createHash("sha256").update(secret).digest("hex");
  const owner = randomUUID(),
    project = randomUUID(),
    run = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema},public`);
    for (const migration of [
      "0001_foundation.sql",
      "0002_role_cache_tokens.sql",
    ])
      await client.query(
        await readFile(
          new URL(`../migrations/${migration}`, import.meta.url),
          "utf8",
        ),
      );
    await client.query(
      "INSERT INTO users(id,email) VALUES($1,'migration@test.invalid')",
      [owner],
    );
    await client.query(
      "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'test','test')",
      [project, owner],
    );
    await client.query(
      "INSERT INTO pipeline_runs(id,project_id,kind,status,request) VALUES($1,$2,'chapter_run','DONE','{}')",
      [run, project],
    );
    const artifact = JSON.stringify({
      output: "clean output",
      promptSha256: hash,
      systemPrompt: secret,
      transcript: [
        { role: "system", content: secret },
        { role: "user", content: "稿件" },
      ],
    });
    const paths = [
      `authoring-ruwen-v5/reports/prompts/${hash}.txt`,
      "authoring-ruwen-v5/reports/runs/test/reader.json",
      "authoring-ruwen-v5/reports/dispatch/test.json",
      "chapters/001.md",
    ];
    for (const p of paths) {
      const bytes = p.endsWith(".txt")
        ? secret
        : p.endsWith(".json")
          ? artifact
          : "正典\r\n原字节";
      await client.query(
        "INSERT INTO project_files(project_id,path,content) VALUES($1,$2,$3)",
        [project, p, Buffer.from(bytes)],
      );
      await client.query(
        "UPDATE project_files SET content=content || convert_to(' ','UTF8') WHERE project_id=$1 AND path=$2",
        [project, p],
      );
    }
    await client.query("INSERT INTO prompts(sha256,content) VALUES($1,$2)", [
      hash,
      secret,
    ]);
    await client.query(
      "INSERT INTO role_runs(run_id,role_id,status,input_sha256,prompt_sha256,result,transcript) VALUES($1,'reader','completed','input',$2,$3,$4)",
      [
        run,
        hash,
        artifact,
        JSON.stringify([{ role: "system", content: secret }]),
      ],
    );
    await client.query(
      await readFile(
        new URL("../migrations/0003_private_prompts.sql", import.meta.url),
        "utf8",
      ),
    );
    const prompt = await client.query(
      "SELECT content FROM prompts WHERE sha256=$1",
      [hash],
    );
    expect(prompt.rows[0].content).toBe(secret);
    for (const table of ["project_files", "project_file_history"]) {
      const files = await client.query(
        `SELECT path,convert_from(content,'UTF8') AS body FROM ${table}`,
      );
      expect(files.rows.some((r) => r.path.includes("/prompts/"))).toBe(false);
      for (const file of files.rows) expect(file.body).not.toContain(secret);
    }
    const preserved = await client.query(
      "SELECT content FROM project_files WHERE path='chapters/001.md'",
    );
    expect(preserved.rows[0].content).toEqual(Buffer.from("正典\r\n原字节 "));
    const result = await client.query(
      "SELECT result,transcript FROM role_runs",
    );
    expect(JSON.stringify(result.rows)).not.toContain(secret);
    expect(result.rows[0].result.output).toBe("clean output");
    expect(result.rows[0].transcript).toEqual([]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
