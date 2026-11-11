import { readFileSync } from "node:fs";

export function modelProfile() {
  const profile = process.env.MODEL_PROFILE ?? "default";
  if (!["default", "deepseek"].includes(profile))
    throw new Error("MODEL_PROFILE must be default or deepseek");
  return profile;
}
/** Profiles replace routing only; default role budgets and editing invariants remain shared. */
export function readModelRoutes<T>() {
  const base = JSON.parse(
    readFileSync(
      new URL("../../../config/models.json", import.meta.url),
      "utf8",
    ),
  );
  if (modelProfile() === "default") return base as T;
  const profile = JSON.parse(
    readFileSync(
      new URL("../../../config/models.deepseek.json", import.meta.url),
      "utf8",
    ),
  );
  return {
    ...base,
    tiers: profile.tiers,
    roleOverrides: profile.roleOverrides,
  } as T;
}
