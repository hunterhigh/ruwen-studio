/** Buffers contain only released deltas. A reset clears one attempt, never saved results. */
export interface RoleStreams {
  readonly buffers: Readonly<Record<string, string>>;
  readonly cursors: Readonly<Record<string, string>>;
}
export const emptyRoleStreams = (): RoleStreams => ({
  buffers: {},
  cursors: {},
});
export interface RoleStreamFrame {
  readonly sessionId: string;
  readonly runId: string;
  readonly role: string;
  readonly id: string;
  readonly type: "delta" | "reset";
  readonly text?: string | undefined;
}
const key = (sessionId: string, runId: string, role: string) =>
  JSON.stringify([sessionId, runId, role]);
export function applyRoleFrame(
  old: RoleStreams,
  frame: RoleStreamFrame,
): RoleStreams {
  if (
    !/^\d+$/.test(frame.id) ||
    !frame.role ||
    (frame.type === "delta" && typeof frame.text !== "string")
  )
    return old;
  const previous = old.cursors[frame.sessionId];
  if (previous !== undefined && BigInt(frame.id) <= BigInt(previous))
    return old;
  const target = key(frame.sessionId, frame.runId, frame.role);
  return {
    cursors: { ...old.cursors, [frame.sessionId]: frame.id },
    buffers: {
      ...old.buffers,
      [target]:
        frame.type === "reset" ? "" : (old.buffers[target] ?? "") + frame.text,
    },
  };
}
export const roleStreamText = (
  state: RoleStreams,
  sessionId: string,
  runId: string,
  role: string,
) => state.buffers[key(sessionId, runId, role)] ?? "";
