import type { PostgresFS } from "@ruwen/db";

export async function persistPrivatePrompt(
  fs: PostgresFS,
  prompt: { sha256: string; content: string },
): Promise<void> {
  await fs.transaction(async (tx) => {
    await tx.sql(
      "INSERT INTO prompts(sha256,content) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [prompt.sha256, prompt.content],
    );
  });
}
