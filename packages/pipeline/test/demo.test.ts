import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFauxRuntime } from "@ruwen/agents";
import { checks, LocalDirFS, packet, state } from "@ruwen/core";
import { expect, it } from "vitest";
import { startChapter } from "../src/index.ts";

it("5.0 demo remains ready and bounded after byte-for-byte copy to another directory", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ruwen-demo-"));
  try {
    const source = new LocalDirFS(
      fileURLToPath(new URL("../../../fixtures/demo-project", import.meta.url)),
    );
    const fs = new LocalDirFS(path.join(parent, "copied"));
    await fs.transaction(async (tx) => {
      for (const p of await source.list())
        await tx.write(p, await source.read(p));
    });
    expect((await checks.projectReadiness(fs)).ready).toBe(true);
    expect(
      (await state.computeStatus(fs, await state.loadState(fs)))
        .ready_to_compile,
    ).toBe(true);
    const compiled = await packet.compilePacket(
      fs,
      "authoring-ruwen-v5/manifests/author-manifest.json",
    );
    expect(
      Array.from(await fs.readText(compiled.output)).length,
    ).toBeLessThanOrEqual(8000);
    const run = await startChapter(
      fs,
      { chapter: 1 },
      { projectKey: "demo-ruwen", runtime: createFauxRuntime() },
    );
    expect(run.status, run.error).toBe("AWAITING_CANDIDATE_APPROVAL");
    expect(await fs.exists(run.target)).toBe(false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}, 20000);
