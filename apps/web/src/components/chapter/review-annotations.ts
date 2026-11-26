import type { Detail } from "./review-data.ts";
import { editsFrom, readingFrom, verdictFrom } from "./review-data.ts";

type SavedAnnotation = Detail["annotations"][number];
export type AnnotationView = Pick<
  SavedAnnotation,
  "id" | "kind" | "status" | "usefulness"
> & { persisted: boolean };
export type AnnotationFilter =
  | "all"
  | "open"
  | "reader"
  | "editor"
  | "verification";
export type FeedbackPatch = Partial<
  Pick<SavedAnnotation, "status" | "usefulness">
>;
export type AnnotationRevision = "revert_editor_edits" | "reapply_editor_edits";

export function isVerifier({ kind }: AnnotationView) {
  return kind === "plot" || kind === "reality";
}

export function showsAnnotation(
  note: AnnotationView,
  filter: AnnotationFilter,
) {
  if (filter === "all") return true;
  if (filter === "open") return note.status === "open";
  return filter === "verification" ? isVerifier(note) : note.kind === filter;
}

export function annotationCounts(notes: readonly AnnotationView[]) {
  return {
    total: notes.length,
    processed: notes.filter(({ status }) => status !== "open").length,
  };
}

export function markerFraction(offset: number | undefined, length: number) {
  if (offset === undefined || !Number.isFinite(offset) || length <= 0)
    return undefined;
  return Math.max(0, Math.min(1, offset / length));
}

export function reviewAnnotations(data: Detail | undefined) {
  const records = new Map(
    data?.annotations?.map((item) => [`${item.roleId}:${item.index}`, item]),
  );
  function bind<T extends { sourceIndex: number }>(
    findings: readonly T[],
    roleId: string,
    kind: AnnotationView["kind"],
  ) {
    return findings.map((finding) => {
      const key = `${roleId}:${finding.sourceIndex}`;
      const record = records.get(key);
      const annotation: AnnotationView = record
        ? { ...record, persisted: true }
        : { id: key, kind, status: "open", usefulness: null, persisted: false };
      return { finding, annotation };
    });
  }
  const readers = bind(
    readingFrom(data?.reports["qinggan-duzhe"]?.output),
    "qinggan-duzhe",
    "reader",
  );
  const editors = bind(
    editsFrom(data?.reports["wenxue-bianji"]?.output),
    "wenxue-bianji",
    "editor",
  );
  const verdicts = (
    [
      ["qingjie-heyanyuan", "plot"],
      ["xianshi-heyanyuan", "reality"],
    ] as const
  ).map(([role, kind]) => {
    const verdict = verdictFrom(data?.reports[role]?.output);
    return {
      role,
      pass: verdict?.pass,
      issues: bind(verdict?.issues ?? [], role, kind),
    };
  });
  const all = [
    ...readers,
    ...editors,
    ...verdicts.flatMap(({ issues }) => issues),
  ].map(({ annotation }) => annotation);
  return { readers, editors, verdicts, all };
}

export type ReviewAnnotations = ReturnType<typeof reviewAnnotations>;
