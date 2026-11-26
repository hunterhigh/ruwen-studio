import { candidateCopy as c } from "../../copy/zh-CN.ts";
import type { Detail } from "./review-data.ts";

type CandidateVersion = NonNullable<Detail["run"]["candidateVersions"]>[number];
type VersionIdentity = Pick<CandidateVersion, "version" | "source" | "op">;

export function candidateVersionLabels(versions: readonly VersionIdentity[]) {
  const labels = new Map<number, string>();
  let userVersion = 0;
  for (const { version, source } of versions.toSorted(
    (a, b) => a.version - b.version,
  )) {
    labels.set(
      version,
      source === "author"
        ? c.author
        : source === "editor"
          ? c.editorVersion
          : c.userVersion(++userVersion),
    );
  }
  return labels;
}

export function verificationBasisVersion(
  run: Pick<
    Detail["run"],
    "verificationBasisSha256" | "verificationRunId" | "reverification"
  >,
  versions: readonly Pick<CandidateVersion, "version" | "sha256" | "source">[],
) {
  const basis = run.verificationBasisSha256;
  if (!basis) return undefined;
  const check = run.reverification;
  if (check && check.id === run.verificationRunId && check.sha256 === basis)
    return check.version;
  const matches = versions.filter((item) => item.sha256 === basis);
  if (matches.length === 1) return matches[0]?.version;
  return run.verificationRunId
    ? undefined
    : matches.find(({ source }) => source === "editor")?.version;
}
