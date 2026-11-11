import type { ProjectFS } from "@ruwen/core";

export const exactTextDirectory = "authoring-ruwen-v5/exact-text/";
export const exactBindingPath = (file: string) => `${file}.binding.json`;
interface Binding {
  version: 1;
  chapter: string;
  path: string;
  sha256: string;
  active: boolean;
}
const normalizedChapter = (chapter: string) =>
  /^\d+$/.test(chapter) ? String(BigInt(chapter)) : chapter;
async function binding(fs: ProjectFS, file: string): Promise<Binding | null> {
  const path = exactBindingPath(file);
  if (!(await fs.exists(path))) return null;
  const value = JSON.parse(await fs.readText(path)) as Binding;
  if (
    value.version !== 1 ||
    value.path !== file ||
    typeof value.chapter !== "string" ||
    typeof value.active !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    throw new Error("Invalid approved exact-text binding");
  return value;
}
export async function ensureExactTextChapter(
  fs: ProjectFS,
  manifestPath: string,
  chapter: string,
) {
  await fs.transaction(async (tx) => {
    const manifest = JSON.parse(await tx.readText(manifestPath));
    const file = manifest.user_authored_text?.path;
    if (typeof file !== "string") return;
    const record = await binding(tx, file);
    if (!record) {
      if (file.startsWith(`${exactTextDirectory}v12-`))
        throw new Error("Missing approved exact-text binding");
      return;
    }
    if (
      !record.active ||
      normalizedChapter(record.chapter) !== normalizedChapter(chapter)
    ) {
      manifest.user_authored_text = null;
      await tx.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }
    if ((await tx.sha256(file)) !== record.sha256)
      throw new Error("Approved exact-text changed");
  });
}
/** Called INSIDE the canonical approval transaction; no later chapter inherits the slot. */
export async function clearChapterExactText(
  fs: ProjectFS,
  manifestPath: string | undefined,
  chapter: string,
) {
  for (const path of await fs.list(exactTextDirectory)) {
    if (!path.endsWith(".binding.json")) continue;
    const file = path.slice(0, -".binding.json".length),
      record = await binding(fs, file);
    if (
      record?.active &&
      normalizedChapter(record.chapter) === normalizedChapter(chapter)
    ) {
      await fs.write(path, `${JSON.stringify({ ...record, active: false })}\n`);
    }
  }
  if (manifestPath && (await fs.exists(manifestPath)))
    await ensureExactTextChapter(fs, manifestPath, chapter);
}
