import { randomUUID } from "node:crypto";
import { createFauxRuntime, FAUX_PROSE } from "@ruwen/agents";
import { exportProjectZip } from "@ruwen/core";
import { annotationStats, listRunAnnotations } from "@ruwen/db";
import { loadRun } from "@ruwen/pipeline";
import { expect, it } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import { fixture } from "./helpers.ts";

it("versions editor changes atomically and keeps ratings and reader decisions independent of approval", async () => {
  const edits = [
    { original: "旧伤", replacement: "腿痛", kind: "literary", reason: "用词" },
    { original: "木牌", replacement: "牌子", kind: "literary", reason: "用词" },
  ];
  const { fs, service } = await fixture({
    runtime: () =>
      createFauxRuntime(
        Array.from({ length: 12 }, () => (context) => {
          const response = defaultFauxResponse(context);
          if (requestRole(context) === "wenxue-bianji") {
            const tool = response.content.find(
              (entry) => entry.type === "toolCall",
            );
            if (tool) tool.arguments = { ...tool.arguments, edits };
          }
          return response;
        }),
      ),
  });
  try {
    const id = await service.enqueueChapter(fs, {
      chapter: 1,
      lockedEvents: ["粮车离开驿站"],
    });
    const task = { runId: id, projectId: fs.projectId, ownerId: fs.ownerId };
    await service.handle({ kind: "chapter", ...task });
    const before = await loadRun(fs, id);
    expect(before.status, before.error).toBe("AWAITING_CANDIDATE_APPROVAL");
    if (!before.candidateSha256 || !before.paths.candidate)
      throw new Error("Missing candidate");
    const list = () => listRunAnnotations(service.db, fs.projectId, id);
    const initial = await list();
    expect(await list()).toEqual(initial);
    const editor = initial.filter((item) => item.kind === "editor");
    const role = (
      await service.db.pool.query<{ id: string }>(
        "SELECT id FROM role_runs WHERE run_id=$1 AND role_id='wenxue-bianji'",
        [id],
      )
    ).rows[0];
    expect(editor.map(({ id, index }) => ({ id, index }))).toEqual([
      { id: `${role?.id}:0`, index: 0 },
      { id: `${role?.id}:1`, index: 1 },
    ]);
    const editIds = editor.map(({ id }) => id);
    const first = editor[0];
    const reader = initial.find((item) => item.kind === "reader");
    if (!first || !reader) throw new Error("Missing opinions");
    const update = (
      annotationId: string,
      patch: Parameters<typeof service.updateAnnotation>[3],
    ) => service.updateAnnotation(fs, id, annotationId, patch);
    const revert = (sha: string, ids = editIds) =>
      service.reviseCandidate(fs, id, sha, {
        op: "revert_editor_edits",
        editIds: ids,
      });
    const reapply = (sha: string) =>
      service.reviseCandidate(fs, id, sha, {
        op: "reapply_editor_edits",
        editIds,
      });
    const audit = async () =>
      (
        await service.db.pool.query<{ op: string }>(
          "SELECT op FROM candidate_revision_audit WHERE run_id=$1 ORDER BY version",
          [id],
        )
      ).rows.map(({ op }) => op);
    const approve = (expectedSha256: string) =>
      service.handle({
        kind: "candidate",
        ...task,
        decision: { confirmed: true, expectedSha256 },
      });
    await update(first.id, { usefulness: "useful" });
    await expect(
      update(first.id, { status: "dismissed" }),
    ).rejects.toMatchObject({ status: 409 });
    const unknown = `${randomUUID()}:0`;
    await expect(
      revert(before.candidateSha256, [...editIds, unknown]),
    ).rejects.toMatchObject({
      status: 409,
      editIds: [unknown],
    });
    await expect(revert("0".repeat(64))).rejects.toMatchObject({ status: 409 });
    expect(await audit()).toEqual([]);
    expect((await loadRun(fs, id)).candidateVersion).toBe(
      before.candidateVersion,
    );
    expect((await list()).find(({ id }) => id === first.id)).toMatchObject({
      status: "open",
      usefulness: "useful",
    });

    const reverted = await revert(before.candidateSha256);
    expect(await service.candidateRevision(fs, id, reverted.version)).toBe(
      FAUX_PROSE,
    );
    expect((await loadRun(fs, id)).candidateVersions?.at(-1)).toMatchObject({
      source: "user",
      op: "revert_editor_edits",
    });
    expect(
      (await list())
        .filter(({ kind }) => kind === "editor")
        .map(({ status }) => status),
    ).toEqual(["dismissed", "dismissed"]);
    await expect(
      update(first.id, { status: "accepted" }),
    ).rejects.toMatchObject({ status: 409 });
    const restored = await reapply(reverted.sha256);
    const editorText = await fs.readText(before.paths.candidate);
    expect(await service.candidateRevision(fs, id, restored.version)).toBe(
      editorText,
    );
    expect((await list()).find(({ id }) => id === first.id)).toMatchObject({
      status: "accepted",
      usefulness: "useful",
    });

    const ambiguous = await service.reviseCandidate(
      fs,
      id,
      restored.sha256,
      `${editorText}\n\n腿痛`,
    );
    await expect(revert(ambiguous.sha256)).rejects.toMatchObject({
      status: 409,
      editIds: [first.id],
    });
    expect((await loadRun(fs, id)).candidateVersion).toBe(ambiguous.version);
    expect(await audit()).toEqual([
      "revert_editor_edits",
      "reapply_editor_edits",
      "manual",
    ]);
    const unique = await service.reviseCandidate(
      fs,
      id,
      ambiguous.sha256,
      editorText,
    );
    const final = await revert(unique.sha256);
    expect((await loadRun(fs, id)).verificationBasisSha256).toBe(
      before.candidateSha256,
    );
    await expect(approve(before.candidateSha256)).rejects.toThrow();
    await approve(final.sha256);
    expect((await loadRun(fs, id)).status).toBe("CANDIDATE_APPROVED");
    await expect(reapply(final.sha256)).rejects.toMatchObject({ status: 409 });
    expect(await update(first.id, { usefulness: null })).toMatchObject({
      status: "dismissed",
      usefulness: null,
    });

    const zip = await exportProjectZip(fs);
    expect(
      await update(reader.id, { status: "accepted", usefulness: "not_useful" }),
    ).toMatchObject({ status: "accepted", usefulness: "not_useful" });
    expect(
      await update(reader.id, { status: "dismissed", usefulness: null }),
    ).toMatchObject({ status: "dismissed", usefulness: null });
    expect(await exportProjectZip(fs)).toEqual(zip);
  } finally {
    await service.stop();
  }
}, 30000);

it("aggregates all findings and rated subsets by UTC completion date and role", async () => {
  const { fs, service } = await fixture();
  try {
    const id = await service.enqueueChapter(fs, {
      chapter: 1,
      lockedEvents: ["粮车离开驿站"],
    });
    const addRole = async (
      role: string,
      finishedAt: string,
      output: unknown,
    ) => {
      const roleRunId = randomUUID();
      await service.db.pool.query(
        "INSERT INTO role_runs(id,run_id,role_id,status,input_sha256,result,finished_at) VALUES($1,$2,$3,'completed','test',$4,$5)",
        [roleRunId, id, role, JSON.stringify({ output }), finishedAt],
      );
      return roleRunId;
    };
    const reader = await addRole("qinggan-duzhe", "2088-01-02T00:00:00Z", {
      reactions: [{}, {}, {}],
    });
    const plot = await addRole("qingjie-heyanyuan", "2088-01-02T23:59:59Z", {
      issues: [{}],
    });
    await addRole("xianshi-heyanyuan", "2088-01-03T00:00:00Z", {
      issues: [{}],
    });
    await service.updateAnnotation(fs, id, `${reader}:0`, {
      status: "accepted",
      usefulness: "useful",
    });
    await service.updateAnnotation(fs, id, `${reader}:1`, {
      status: "dismissed",
      usefulness: "not_useful",
    });
    await service.updateAnnotation(fs, id, `${plot}:0`, { status: "accepted" });
    expect(
      await annotationStats(service.db, "2088-01-02", "2088-01-02"),
    ).toEqual([
      {
        kind: "plot",
        total: 1,
        accepted: 1,
        dismissed: 0,
        useful: 0,
        notUseful: 0,
      },
      {
        kind: "reader",
        total: 3,
        accepted: 1,
        dismissed: 1,
        useful: 1,
        notUseful: 1,
      },
    ]);
  } finally {
    await service.stop();
  }
}, 20000);
