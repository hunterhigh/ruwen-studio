import { readFileSync } from "node:fs";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { describe, expect, it } from "vitest";
import {
  ROLE_IDS,
  ROLES,
  resolveRoute,
  roleGenerationPolicy,
} from "../src/index.ts";

interface Routing {
  tiers: Record<
    string,
    { provider: string; modelId: string; thinkingLevel: string }
  >;
}

const routing: Routing = JSON.parse(
  readFileSync(new URL("../../../config/models.json", import.meta.url), "utf8"),
);

describe("provisional model routes", () => {
  const provider = anthropicProvider();
  for (const [tier, route] of Object.entries(routing.tiers)) {
    it(`${tier} names a model and thinking level in the installed catalog`, () => {
      expect(route.provider).toBe(provider.id);
      const model = provider
        .getModels()
        .find((candidate) => candidate.id === route.modelId);
      expect(model).toBeDefined();
      if (!model) throw new Error(`Unknown model: ${route.modelId}`);
      expect(getSupportedThinkingLevels(model)).toContain(route.thinkingLevel);
      expect(route.modelId).toBe(
        `claude-${tier === "strong" ? "opus" : tier === "standard" ? "sonnet" : "haiku"}-5-5`,
      );
      expect(model.compat?.forceAdaptiveThinking).toBe(true);
      for (const id of ROLE_IDS.filter(
        (id) => resolveRoute(ROLES[id]).modelId === model.id,
      ))
        expect(roleGenerationPolicy(id).maxTokens).toBeLessThanOrEqual(
          model.maxTokens,
        );
    });
  }
});
