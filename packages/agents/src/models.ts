import { readFileSync } from "node:fs";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createModels,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { ModelRuntime, RoleSpec } from "./types.ts";

interface Route {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}
interface Routes {
  tiers: Record<string, Route>;
  roleOverrides: Record<string, Route>;
}
const routePath = new URL("../../../config/models.json", import.meta.url);
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
