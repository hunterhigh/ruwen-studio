import {
  assertMaterialText,
  checks,
  ledgers,
  type ProjectFS,
} from "@ruwen/core";
import { type ChapterRun, loadRun, runPath } from "./index.ts";

export type CandidateRevisionOperation =
  | "manual"
  | "revert_editor_edits"
  | "reapply_editor_edits";

export interface CandidateVersion {
  version: number;
  sha256: string;
  source: "author" | "editor" | "user";
  op: CandidateRevisionOperation | null;
  createdAt: string;
  chars: number;
  path: string;
}

export type ReverificationStatus =
  | "pending"
  | "passed"
  | "returned"
  | "failed"
  | "cancelled"
  | "stale";
export interface Reverification {
  id: string;
  version: number;
  sha256: string;
  status: ReverificationStatus;
}

export class CandidateRevisionError extends Error {
  readonly status: 400 | 404 | 409 | 413;
  constructor(status: 400 | 404 | 409 | 413, message: string) {
    super(message);
    this.status = status;
  }
}

const changed = "候选稿已在别处更新，请刷新。";

export async function describeCandidateVersions(
  fs: ProjectFS,
  run: ChapterRun,
) {
  if (run.candidateVersions)
    return {
      candidateVersions: run.candidateVersions,
      candidateVersion: run.candidateVersion,
      verificationBasisSha256: run.verificationBasisSha256,
    };
  const candidateVersions: CandidateVersion[] = [];
  const author = run.paths.original ?? run.paths.author;
  const editor = run.paths.candidate;
  const editorTime = run.events?.find(
    ({ status }) => status === "AWAITING_CANDIDATE_APPROVAL",
  )?.time;
  const authorTime = run.events?.find(
    ({ status }) => status === "AUTHOR_DONE",
  )?.time;
  for (const [file, source, time] of [
    [author, "author", authorTime],
    [editor, "editor", editorTime],
  ] as const) {
    if (file && time && (await fs.exists(file))) {
      candidateVersions.push({
        version: candidateVersions.length + 1,
        sha256: await fs.sha256(file),
        source,
        op: null,
        createdAt: time,
        chars: Array.from(await fs.readText(file)).length,
        path: file,
      });
    }
  }
  return {
    candidateVersions,
    candidateVersion: candidateVersions.findLast(
      ({ source }) => source === "editor",
    )?.version,
    verificationBasisSha256: run.candidateSha256,
  };
}

export async function requireCandidateVersion(
  fs: ProjectFS,
  run: ChapterRun,
  expectedSha256: string,
) {
  const path = run.paths.candidate;
  if (run.status !== "AWAITING_CANDIDATE_APPROVAL")
    throw new CandidateRevisionError(
      409,
      "当前候选稿不在等待批准，请刷新核对状态。",
    );
  if (
    !path ||
    run.candidateSha256 !== expectedSha256 ||
    !(await fs.exists(path)) ||
    (await fs.sha256(path)) !== expectedSha256
  )
    throw new CandidateRevisionError(409, changed);
  const versions = await describeCandidateVersions(fs, run);
  const current = versions.candidateVersions.at(-1);
  if (
    !current ||
    current.version !== versions.candidateVersion ||
    current.path !== path ||
    current.sha256 !== expectedSha256
  )
    throw new CandidateRevisionError(409, changed);
  return { current, ...versions };
}

export function pendingReverification(run: ChapterRun) {
  return (
    run.reverification?.status === "pending" &&
    run.reverification.version === run.candidateVersion &&
    run.reverification.sha256 === run.candidateSha256
  );
}

export function candidateText(value: string) {
  const text = value.replace(/\r\n?/g, "\n");
  if (!text.trim() || /[\uD800-\uDFFF]/u.test(text))
    throw new CandidateRevisionError(400, "请填写有效的候选正文。");
  try {
    assertMaterialText(text);
  } catch {
    throw new CandidateRevisionError(413, "候选正文超过允许的字符上限。");
  }
  if (checks.candidateProseErrors(text).length)
    throw new CandidateRevisionError(
      400,
      "候选正文包含治理、来源或履约元语言。",
    );
  return text;
}

function changedCharacters(before: string, after: string) {
  const left = Array.from(before),
    right = Array.from(after);
  let start = 0,
    end = 0;
  const shorter = Math.min(left.length, right.length);
  while (start < shorter && left[start] === right[start]) start++;
  while (
    end < shorter - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  )
    end++;
  return Math.max(left.length, right.length) - start - end;
}

export async function saveCandidateRevision(
  fs: ProjectFS,
  runId: string,
  baseSha256: string,
  value: string,
  op: CandidateRevisionOperation,
  record: (
    transaction: ProjectFS,
    revision: CandidateVersion,
    baseSha256: string,
    changedChars: number,
  ) => Promise<void>,
) {
  const text = candidateText(value);
  return fs.transaction(async (tx) => {
    const run = await loadRun(tx, runId);
    const history = await requireCandidateVersion(tx, run, baseSha256);
    const before = await tx.readText(history.current.path);
    const version = history.current.version + 1;
    const path = `authoring-ruwen-v5/candidates/${runId}-user-v${version}.md`;
    await tx.createExclusive(path, text);
    const revision: CandidateVersion = {
      version,
      sha256: await tx.sha256(path),
      source: "user",
      op,
      createdAt: new Date().toISOString(),
      chars: Array.from(text).length,
      path,
    };
    run.candidateVersion = version;
    run.candidateVersions = [...history.candidateVersions, revision];
    if (history.verificationBasisSha256 !== undefined)
      run.verificationBasisSha256 = history.verificationBasisSha256;
    run.candidateSha256 = revision.sha256;
    run.paths.candidate = path;
    await tx.write(runPath(runId), `${JSON.stringify(run, null, 2)}\n`);
    await ledgers.appendAudit(tx, {
      role: "user-author",
      resource_ids: [],
      change: "candidate_user_revision",
      scope: {
        project: run.projectKey,
        volume: null,
        arc: null,
        chapter: run.chapter,
      },
      conflict_category: null,
      approval_status: "not_required",
      result: "saved",
    });
    await record(tx, revision, baseSha256, changedCharacters(before, text));
    return { version, sha256: revision.sha256 };
  });
}

export async function readCandidateRevision(
  fs: ProjectFS,
  run: ChapterRun,
  version: number,
) {
  const { candidateVersions } = await describeCandidateVersions(fs, run);
  const revision = candidateVersions.find((item) => item.version === version);
  if (
    !revision ||
    !(await fs.exists(revision.path)) ||
    (await fs.sha256(revision.path)) !== revision.sha256
  )
    throw new CandidateRevisionError(404, "候选版本不存在。");
  return fs.readText(revision.path);
}
