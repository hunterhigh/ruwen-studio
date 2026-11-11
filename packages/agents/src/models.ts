import { readFileSync } from "node:fs";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createModels,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { EditPolicy } from "@ruwen/core";
import { environmentCredentials } from "./runtime/credential-runtime.ts";
import { processModelKey } from "./runtime/model-credentials.ts";
import type { ModelRuntime, RoleId, RoleSpec } from "./types.ts";

interface Route {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}
export const ROLE_OUTPUT_ATTEMPTS = 2;
interface Routes {
  tiers: Record<string, Route>;
  roleOverrides: Record<string, Route>;
  roles: Record<
    RoleId,
    { maxTokens: number; timeoutMs: number; basis: string }
  >;
  editing: EditPolicy;
}
const routePath = new URL("../../../config/models.json", import.meta.url);
export const DEFAULT_ROLE_TIMEOUT_MS = Math.max(
  ...Object.values(
    (JSON.parse(readFileSync(routePath, "utf8")) as Routes).roles,
  ).map((role) => role.timeoutMs),
);
export function roleGenerationPolicy(id: RoleId) {
  const policy = (JSON.parse(readFileSync(routePath, "utf8")) as Routes).roles[
    id
  ];
  if (
    !policy ||
    !Number.isInteger(policy.maxTokens) ||
    policy.maxTokens < 1 ||
    !Number.isFinite(policy.timeoutMs) ||
    policy.timeoutMs <= 0 ||
    !policy.basis?.trim()
  )
    throw new Error("Role token policy is not configured");
  return policy;
}
export function editingPolicy(): EditPolicy {
  const policy = (JSON.parse(readFileSync(routePath, "utf8")) as Routes)
    .editing;
  if (
    !policy ||
    !(policy.maxChangedRatio > 0 && policy.maxChangedRatio <= 0.15)
  )
    throw new Error("Edit ratio must be positive and no greater than 15%");
  return policy;
}
export function resolveRoute(spec: RoleSpec): Route {
  const routes = JSON.parse(readFileSync(routePath, "utf8")) as Routes;
  const route = routes.roleOverrides[spec.id] ?? routes.tiers[spec.modelTier];
  if (!route) throw new Error("Model route is not configured");
  return route;
}
export function createRealRuntime(): ModelRuntime {
  const models = createModels();
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  return environmentCredentials({
    mode: "real",
    models,
    resolve(spec) {
      if (process.env.REAL_MODEL !== "1")
        throw new Error("Real model calls require REAL_MODEL=1");
      const route = resolveRoute(spec);
      const model = models.getModel(route.provider, route.modelId);
      if (!model)
        throw new Error("Model is absent from the installed provider catalog");
      if (!getSupportedThinkingLevels(model).includes(route.thinkingLevel))
        throw new Error("Unsupported thinking level for configured model");
      processModelKey(route.provider);
      return { model, thinkingLevel: route.thinkingLevel };
    },
  });
}
/** Catalog lookup for offline replay; it never resolves credentials or performs a request. */
export function resolveCatalogModel(spec: RoleSpec) {
  const route = resolveRoute(spec),
    models = createModels();
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  const model = models.getModel(route.provider, route.modelId);
  if (
    !model ||
    !getSupportedThinkingLevels(model).includes(route.thinkingLevel)
  )
    throw new Error("Invalid replay catalog route");
  return { model, thinkingLevel: route.thinkingLevel };
}
