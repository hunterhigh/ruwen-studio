import { createRealRuntime, resolveCatalogModel } from "../models.ts";
import type { ModelRuntime } from "../types.ts";
import { createScenarioRuntime } from "./scenarios.ts";
import { tapeRuntime } from "./tapes.ts";
export const MODEL_MODES = ["faux", "real", "record", "replay"] as const;
export type ModelMode = (typeof MODEL_MODES)[number];
export function createApplicationRuntime(options: {
  mode: string;
  workspaceRoot: string;
  scenario?: string;
  initialDelayMs?: number;
  characterDelayMs?: number;
  /** Tests can record an injected faux upstream without using credentials. */
  upstream?: ModelRuntime;
}): ModelRuntime {
  if (!(MODEL_MODES as readonly string[]).includes(options.mode))
    throw new Error("MODEL_MODE must be faux, real, record or replay");
  if (options.mode === "faux") return createScenarioRuntime(options);
  if (options.mode === "real") return options.upstream ?? createRealRuntime();
  const base = options.upstream ?? createRealRuntime();
  return tapeRuntime(
    options.mode === "replay" && !options.upstream
      ? { ...base, resolve: resolveCatalogModel }
      : base,
    options.mode as "record" | "replay",
    options.workspaceRoot,
    options.characterDelayMs ?? 0,
  );
}
