import { AlreadyExists, type ProjectFS } from "../fs/project-fs.ts";
import {
  CoreError,
  encodedText,
  keysEqual,
  type ObjectData,
  object,
  pyJson,
  readJson,
  requireFile,
  text,
  utcNow,
} from "../runtime.ts";

export const ACTIONS = [
  "handoff_execute",
  "candidate_approve",
  "memory_commit",
  "resource_activate",
  "expression_activate",
];
export const USAGE = "治理/审批/已使用";
const idPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;
export interface Reservation {
  entry: ObjectData;
  pendingPath: string;
  finalPath: string;
}
export async function usageEntries(fs: ProjectFS): Promise<ObjectData[]> {
  const entries: ObjectData[] = [];
  for (const p of await fs.list(USAGE))
    if (/^[^/]+\.json$/.test(p.slice(USAGE.length + 1)))
      entries.push(await readJson(fs, p));
  return entries;
}
export const eventIsCommitted = (fs: ProjectFS, id: string) =>
  fs.exists(`${USAGE}/${id}.json`);
export const eventIsConsumed = async (fs: ProjectFS, id: string) =>
  (await eventIsCommitted(fs, id)) ||
  (await fs.exists(`${USAGE}/.${id}.pending`));
export async function validateEvent(
  fs: ProjectFS,
  value: unknown,
  action: string,
  target: string,
  state?: ObjectData,
  allowConsumed = false,
): Promise<ObjectData> {
  if (!object(value)) throw new CoreError("批准事件必须是对象");
  if (
    !keysEqual(value, [
      "schema_version",
      "id",
      "action",
      "target_path",
      "target_sha256",
      "approved_at",
      "approved_by",
      "consumed",
    ])
  )
    throw new CoreError("批准事件字段不完整或含额外字段");
  if (
    value.schema_version !== "1.0" ||
    value.action !== action ||
    value.approved_by !== "user"
  )
    throw new CoreError("批准事件身份或动作不匹配");
  if (!text(value.id) || !idPattern.test(value.id))
    throw new CoreError("批准事件ID无效");
  if (!text(value.approved_at) || Number.isNaN(Date.parse(value.approved_at)))
    throw new CoreError("批准时间无效");
  if (!text(value.target_sha256) || !/^[0-9a-f]{64}$/.test(value.target_sha256))
    throw new CoreError("批准目标哈希无效");
  if (value.consumed !== false) throw new CoreError("批准事件已经使用");
  if (
    value.target_path !== fs.path(target) ||
    value.target_sha256 !== (await fs.sha256(target))
  )
    throw new CoreError("批准事件没有绑定当前目标版本");
  if (
    Array.isArray(state?.consumed_approval_ids) &&
    state.consumed_approval_ids.includes(value.id)
  )
    throw new CoreError("批准事件已在项目状态中消费");
  if (!allowConsumed && (await eventIsConsumed(fs, value.id)))
    throw new CoreError("批准事件已在批准消费账本中使用");
  return value;
}
export async function reserveEvent(
  fs: ProjectFS,
  event: ObjectData,
  consumer: string,
): Promise<Reservation> {
  if (!text(event.id) || !idPattern.test(event.id))
    throw new CoreError("批准事件ID无效");
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(consumer))
    throw new CoreError("批准消费岗位标识无效");
  const id = event.id;
  return fs.transaction(async (tx) => {
    const pendingPath = `${USAGE}/.${id}.pending`;
    const finalPath = `${USAGE}/${id}.json`;
    if (await tx.exists(finalPath)) throw new CoreError("批准事件已经使用");
    const entry: ObjectData = {
      event_id: id,
      action: event.action ?? null,
      target_path: event.target_path ?? null,
      target_sha256: event.target_sha256 ?? null,
      consumer,
      consumed_at: utcNow(),
    };
    try {
      await tx.createExclusive(pendingPath, `${pyJson(entry, false)}\n`);
    } catch (error) {
      if (error instanceof AlreadyExists)
        throw new CoreError("批准事件正在被另一岗位使用");
      throw error;
    }
    return { entry, pendingPath, finalPath };
  });
}
export async function commitReservation(
  fs: ProjectFS,
  reservation: Reservation,
): Promise<ObjectData> {
  return fs.transaction(async (tx) => {
    if (await tx.exists(reservation.finalPath))
      throw new CoreError("批准事件已经使用");
    const pending = await readJson(tx, reservation.pendingPath);
    if (pyJson(pending) !== pyJson(reservation.entry))
      throw new CoreError("批准预留已变化");
    await tx.createExclusive(
      reservation.finalPath,
      await tx.read(reservation.pendingPath),
    );
    await tx.remove(reservation.pendingPath);
    return reservation.entry;
  });
}
export const rollbackReservation = async (
  fs: ProjectFS,
  reservation?: Reservation | null,
) => {
  if (reservation) await fs.remove(reservation.pendingPath);
};
export const consumeEvent = (
  fs: ProjectFS,
  event: ObjectData,
  consumer: string,
) =>
  fs.transaction(async (tx) =>
    commitReservation(tx, await reserveEvent(tx, event, consumer)),
  );
export async function createEvent(
  fs: ProjectFS,
  id: string,
  action: string,
  target: string,
  confirmed: boolean,
): Promise<ObjectData> {
  if (!confirmed) throw new CoreError("必须显式确认用户已经批准", 1);
  if (!idPattern.test(id)) throw new CoreError("event-id格式无效", 1);
  if (!ACTIONS.includes(action)) throw new CoreError("未知批准动作");
  return fs.transaction(async (tx) => {
    const p = await requireFile(tx, target);
    const output = `治理/审批/${id}.json`;
    const value: ObjectData = {
      schema_version: "1.0",
      id,
      action,
      target_path: p,
      target_sha256: await tx.sha256(p),
      approved_at: utcNow(),
      approved_by: "user",
      consumed: false,
    };
    try {
      await tx.createExclusive(output, encodedText(`${pyJson(value)}\n`));
    } catch (error) {
      if (error instanceof AlreadyExists)
        throw new CoreError("批准事件已存在，不允许覆盖", 1);
      throw error;
    }
    return { status: "recorded", event: output };
  });
}
