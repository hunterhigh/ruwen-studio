import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { demoArchive } from "./lib/demo-archive.ts";

// Build-time artifact. Runtime images never lease or modify their immutable source fixture.
await writeFile(
  fileURLToPath(new URL("../fixtures/demo-project.zip", import.meta.url)),
  await demoArchive(),
);
