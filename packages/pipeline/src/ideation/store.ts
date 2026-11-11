import type { ProjectFS } from "@ruwen/core";
import type { IdeationActor } from "./contract.ts";

/** SQL and project files share this transaction. The adapter must check project ownership. */
export interface IdeationTransaction extends ProjectFS {
  sql<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
export interface IdeationStore {
  transaction<T>(
    actor: IdeationActor,
    operation: (tx: IdeationTransaction) => Promise<T>,
  ): Promise<T>;
}
