import type { Data } from "@ruwen/agents";
import { checks, registry, state } from "@ruwen/core";
import type {
  IdeationActor,
  IdeationCompilationRequest,
  IdeationContextScope,
  IdeationResourceRef,
} from "./contract.ts";
import { resourceMetadata } from "./file-patches.ts";
import { ideationFail, ideationText } from "./sessions.ts";
import type { IdeationTransaction } from "./store.ts";
export const ideationAuthorManifest =
  "authoring-ruwen-v5/manifests/author-manifest.json";
export async function ownedCompilationLocators(
  tx: IdeationTransaction,
  sources: IdeationCompilationRequest["sources"],
) {
  if (!Array.isArray(sources) || sources.length > 64)
    ideationFail("INVALID_ARGUMENT");
  const data = await registry.readRegistry(tx);
  for (const ref of sources)
    if (
      !ref ||
      typeof ref.resourceId !== "string" ||
      !data.resources.some((r) => r.id === ref.resourceId)
    )
      ideationFail("NOT_FOUND");
}

export async function compilationSources(
  tx: IdeationTransaction,
  actor: Pick<IdeationActor, "projectId">,
  request: Pick<IdeationCompilationRequest, "chapter" | "scope" | "sources">,
) {
  const data = await registry.readRegistry(tx);
  if (!Array.isArray(request.sources) || request.sources.length > 64)
    ideationFail("INVALID_ARGUMENT");
  // Resolve every user-supplied locator before readiness/status/hash/billing decisions.
  const supplied = request.sources.map((ref) => {
    const r =
      ref && typeof ref.resourceId === "string"
        ? data.resources.find((r) => r.id === ref.resourceId)
        : undefined;
    if (!r) ideationFail("NOT_FOUND");
    return r;
  });
  for (const ref of request.sources)
    if (
      Object.keys(ref).some(
        (k) => !["resourceId", "expectedSha256"].includes(k),
      ) ||
      typeof ref.expectedSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(ref.expectedSha256)
    )
      ideationFail("INVALID_ARGUMENT");
  if (new Set(supplied.map((r) => r.id)).size !== supplied.length)
    ideationFail("INVALID_ARGUMENT");
  if (
    typeof request.chapter !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(request.chapter)
  )
    ideationFail("INVALID_ARGUMENT");
  const chapter = /^\d+$/.test(request.chapter)
    ? request.chapter.padStart(3, "0")
    : request.chapter;
  const project =
    (
      await tx.sql<{ project_key: string }>(
        "SELECT project_key FROM projects WHERE id=$1",
        [actor.projectId],
      )
    ).rows[0]?.project_key ?? ideationFail("NOT_FOUND");
  let scope: IdeationContextScope;
  try {
    scope = state.validateContextScope(
      { ...request.scope, project, chapter },
      chapter,
    ) as unknown as IdeationContextScope;
    for (const value of Object.values(scope))
      if (value !== null) ideationText(value, 80);
    if (
      Object.hasOwn(request.scope, "project") ||
      Object.hasOwn(request.scope, "chapter")
    )
      ideationFail("INVALID_ARGUMENT");
  } catch {
    ideationFail("INVALID_ARGUMENT");
  }
  const valid = await registry.validateRegistry(tx);
  if (valid.errors.length) ideationFail("PRECONDITION_FAILED");
  for (let i = 0; i < supplied.length; i++)
    if (supplied[i]?.source_sha256 !== request.sources[i]?.expectedSha256)
      ideationFail("RESOURCE_STALE");
  let current: Awaited<ReturnType<typeof state.loadState>>;
  try {
    current = await state.loadState(tx);
  } catch {
    ideationFail("PRECONDITION_FAILED");
  }
  if (
    current.pending_approved_candidate != null ||
    current.pending_consolidation ||
    (await state.baseSourceReasons(tx, current)).length ||
    !(await checks.projectReadiness(tx)).ready
  )
    ideationFail("PRECONDITION_FAILED");
  const base = [current.active_outline, ...current.tracked_sources];
  const required = base.map((ref) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref))
      ideationFail("PRECONDITION_FAILED");
    return (
      data.resources.find((r) => r.path === ref.path) ??
      ideationFail("PRECONDITION_FAILED")
    );
  });
  const resources = [
    ...new Map([...required, ...supplied].map((r) => [r.id, r])).values(),
  ];
  for (const r of resources) {
    if (
      r.scope.project !== project ||
      (!required.some((source) => source.id === r.id) &&
        !registry.scopeMatches(r.scope, scope as unknown as Data)) ||
      !["world", "character", "story"].includes(r.type) ||
      r.status !== "active" ||
      r.approval.status !== "approved" ||
      !r.readers.includes("zhangjie-qingjing-bianyiyuan")
    )
      ideationFail("READERS_DENIED");
    if ((await tx.sha256(r.path)) !== r.source_sha256)
      ideationFail("RESOURCE_STALE");
  }
  const locked = {
    locked_events: [] as string[],
    locked_order: [] as string[],
  };
  const projection = current.active_projection;
  if (
    projection &&
    typeof projection === "object" &&
    !Array.isArray(projection) &&
    projection.chapter === chapter &&
    typeof projection.path === "string" &&
    (await tx.exists(`${projection.path}.promises.json`))
  ) {
    if (
      (await state.validateGeneratedMeta(tx, projection, "projection")).length
    )
      ideationFail("PRECONDITION_FAILED");
    const promises = JSON.parse(
      await tx.readText(`${projection.path}.promises.json`),
    );
    if (promises.projection_sha256 !== projection.sha256)
      ideationFail("PRECONDITION_FAILED");
    for (const key of ["locked_events", "locked_order"] as const) {
      if (
        !Array.isArray(promises[key]) ||
        promises[key].length > 64 ||
        promises[key].some(
          (v: unknown) => typeof v !== "string" || Array.from(v).length > 600,
        )
      )
        ideationFail("PRECONDITION_FAILED");
      locked[key] = promises[key];
    }
  }
  const refs = resources.map(resourceMetadata) as IdeationResourceRef[];
  const input: Data = {
    chapter,
    scope: scope as unknown as Data,
    resources: resources.map((r) => ({ id: r.id })),
    approved_story: {
      id: required[0]?.id ?? ideationFail("PRECONDITION_FAILED"),
    },
    ...locked,
  };
  return {
    input,
    chapter,
    scope,
    resources: refs,
    stateSha256: await tx.sha256(state.STATE),
    registrySha256: await tx.sha256(registry.REGISTRY),
    manifestSha256: await tx.sha256(ideationAuthorManifest),
  };
}
