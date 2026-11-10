import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { defaultUpstreamRoot, PLUGIN } from "../prompts/manifest.ts";

/** Public template exemptions are detector data, never added to any role's context. */
export async function publicTemplateMaterials(
  upstreamRoot = defaultUpstreamRoot,
): Promise<string[]> {
  const root = await realpath(
    path.join(upstreamRoot, PLUGIN, "assets/project-template"),
  );
  const walk = async (directory: string): Promise<string[]> => {
    const result: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error("Public template cannot be a symlink");
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await walk(file)));
      else if (entry.isFile()) result.push(await readFile(file, "utf8"));
      else throw new Error("Invalid public template file");
    }
    return result;
  };
  return walk(root);
}
