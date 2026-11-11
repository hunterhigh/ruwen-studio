import { createHash } from "node:crypto";
import type { IdeationActor } from "./contract.ts";
import { ideationFail } from "./sessions.ts";
import type { IdeationTransaction } from "./store.ts";

export function unpublishedFragments(
  content: string,
  ranges: readonly { start: number; end: number }[],
) {
  const points = Array.from(content),
    result: string[] = [];
  let position = 0;
  for (const { start, end } of [...ranges].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > points.length
    )
      ideationFail("OUTPUT_BLOCKED");
    if (start > position) result.push(points.slice(position, start).join(""));
    position = Math.max(position, end);
  }
  if (position < points.length) result.push(points.slice(position).join(""));
  return result;
}
/** Only approved resource_file ranges are excluded. Creation-check still uses FULL source messages. */
export async function downstreamOriginalSources(
  tx: IdeationTransaction,
  actor: IdeationActor,
  sessionId: string,
  revision?: number,
) {
  const messages = await tx.sql<{ id: string; content: string }>(
    "SELECT id,content FROM ideation_messages WHERE project_id=$1 AND session_id=$2 AND role='user' AND ($3::integer IS NULL OR session_revision<=$3) ORDER BY ordinal",
    [actor.projectId, sessionId, revision ?? null],
  );
  const published = await tx.sql<{
    message_id: string;
    start_position: number;
    end_position: number;
    message_sha256: string;
  }>(
    "SELECT message_id,start_position,end_position,message_sha256 FROM ideation_published_selections WHERE project_id=$1 AND session_id=$2",
    [actor.projectId, sessionId],
  );
  return messages.rows.flatMap((message) =>
    unpublishedFragments(
      message.content,
      published.rows
        .filter(
          (r) =>
            r.message_id === message.id &&
            r.message_sha256 ===
              createHash("sha256").update(message.content).digest("hex"),
        )
        .map((r) => ({ start: r.start_position, end: r.end_position })),
    ),
  );
}
