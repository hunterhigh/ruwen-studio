import { readFileSync } from "node:fs";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createModels,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { EditPolicy } from "@ruwen/core";
import type { ModelRuntime, RoleId, RoleSpec } from "./types.ts";

interface Route {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}
export const DEFAULT_ROLE_TIMEOUT_MS = 600_000;
export const ROLE_OUTPUT_ATTEMPTS = 2;
interface Routes {
  tiers: Record<string, Route>;
  roleOverrides: Record<string, Route>;
  roles: Record<RoleId, { maxTokens: number; basis: string }>;
  editing: EditPolicy;
}
const routePath = new URL("../../../config/models.json", import.meta.url);
export function roleGenerationPolicy(id: RoleId) {
  const policy = (JSON.parse(readFileSync(routePath, "utf8")) as Routes).roles[
    id
  ];
  if (
    !policy ||
    !Number.isInteger(policy.maxTokens) ||
    policy.maxTokens < 1 ||
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
  return {
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
      const variable =
        route.provider === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : route.provider === "openai"
            ? "OPENAI_API_KEY"
            : "";
      if (!variable || !process.env[variable])
        throw new Error(`Missing ${variable || "commercial API credential"}`);
      return { model, thinkingLevel: route.thinkingLevel };
    },
    apiKey(provider) {
      return provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : provider === "openai"
          ? process.env.OPENAI_API_KEY
          : undefined;
    },
  };
}
