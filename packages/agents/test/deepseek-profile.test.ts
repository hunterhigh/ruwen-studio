import { readFileSync } from "node:fs";
import {
  getSupportedThinkingLevels,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { convertMessages } from "@earendil-works/pi-ai/api/openai-completions";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { afterEach, expect, it, vi } from "vitest";
import {
  ROLE_IDS,
  ROLES,
  resolveRoute,
  roleGenerationPolicy,
} from "../src/index.ts";
import { resolveCatalogModel, validateRoleModel } from "../src/models.ts";

afterEach(() => vi.unstubAllEnvs());
it("switches all roles without credentials or altering default Anthropic routing and bounds every output", () => {
  vi.stubEnv("MODEL_PROFILE", "default");
  expect(resolveRoute(ROLES["xiaoshuo-zuozhe"]).provider).toBe("anthropic");
  vi.stubEnv("MODEL_PROFILE", "deepseek");
  for (const id of ROLE_IDS) {
    const spec = ROLES[id],
      route = resolveRoute(spec),
      { model, thinkingLevel } = resolveCatalogModel(spec);
    expect(route.provider).toBe("deepseek");
    expect(model.id).toBe(
      spec.modelTier === "strong" ? "deepseek-v4-pro" : "deepseek-flash",
    );
    const verifier = ["qingjie-heyanyuan", "xianshi-heyanyuan"].includes(id);
    expect(thinkingLevel).toBe(
      spec.modelTier === "cheap" && !verifier ? "off" : "high",
    );
    expect(getSupportedThinkingLevels(model)).toContain(thinkingLevel);
    expect(roleGenerationPolicy(id).maxTokens).toBeLessThanOrEqual(
      model.maxTokens,
    );
  }
  vi.stubEnv("MODEL_PROFILE", "unknown");
  expect(() => resolveRoute(ROLES["xiaoshuo-zuozhe"])).toThrow("MODEL_PROFILE");
});
it("promotes DeepSeek verifiers to the standard route while default routing and the emotional reader stay cheap", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../../../config/models.deepseek.json", import.meta.url),
      "utf8",
    ),
  );
  for (const id of ["qingjie-heyanyuan", "xianshi-heyanyuan"] as const) {
    vi.stubEnv("MODEL_PROFILE", "default");
    expect(resolveRoute(ROLES[id])).toMatchObject({
      provider: "anthropic",
      thinkingLevel: "off",
    });
    vi.stubEnv("MODEL_PROFILE", "deepseek");
    expect(resolveRoute(ROLES[id])).toEqual(config.tiers.standard);
    expect(config.roleOverrides[id]).toEqual(config.tiers.standard);
  }
  expect(resolveRoute(ROLES["qinggan-duzhe"])).toEqual(config.tiers.cheap);
});
it("matches the installed DeepSeek snapshot, including prices, limits, thinking and tools", () => {
  const snapshot = JSON.parse(
    readFileSync(
      new URL("../../../config/model-catalog.json", import.meta.url),
      "utf8",
    ),
  );
  const entry = snapshot.providers.find(
    (p: { provider: string }) => p.provider === "deepseek",
  );
  expect(entry.models).toHaveLength(deepseekProvider().getModels().length);
  for (const model of deepseekProvider().getModels()) {
    const saved = entry.models.find((m: { id: string }) => m.id === model.id);
    expect(saved).toMatchObject({
      id: model.id,
      api: model.api,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: model.cost,
      thinkingLevels: getSupportedThinkingLevels(model),
      toolCalls: true,
      compat: model.compat,
    });
  }
});
it("rejects an unaudited tool model and an output budget exceeding model limits", () => {
  expect(() =>
    validateRoleModel(ROLES["xiangmu-zhiliyuan"], {
      provider: "deepseek",
      id: "no-tools",
      maxTokens: 384000,
    }),
  ).toThrow("tool support");
  expect(() =>
    validateRoleModel(ROLES["xiaoshuo-zuozhe"], {
      provider: "deepseek",
      id: "no-tools",
      maxTokens: 384000,
    }),
  ).not.toThrow();
  expect(() =>
    validateRoleModel(ROLES["xiaoshuo-zuozhe"], {
      provider: "deepseek",
      id: "deepseek-v4-pro",
      maxTokens: 1,
    }),
  ).toThrow("output limit");
});
it.each(
  deepseekProvider().getModels(),
)("$id serializer returns reasoning_content with a tool result, without a provider call", (model) => {
  const thinking = "INTERNAL_PROTOCOL_REASONING",
    context = {
      messages: [
        {
          role: "user" as const,
          content: "Read the authorized resource.",
          timestamp: 0,
        },
        {
          role: "assistant" as const,
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: [
            {
              type: "thinking" as const,
              thinking,
              thinkingSignature: "reasoning_content",
            },
            {
              type: "toolCall" as const,
              id: "call_1",
              name: "read_resource",
              arguments: { id: "allowed" },
            },
          ],
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "toolUse" as const,
          timestamp: 0,
        },
        {
          role: "toolResult" as const,
          toolCallId: "call_1",
          toolName: "read_resource",
          content: [{ type: "text" as const, text: "Authorized material" }],
          isError: false,
          timestamp: 0,
        },
      ],
    };
  // Pure SDK conversion: no HTTP, key resolution or provider dispatch.
  const converted = convertMessages(
    model,
    normalizeContext(context),
    model.compat as Parameters<typeof convertMessages>[2],
  );
  const assistant = converted.find(
    (m) => m.role === "assistant",
  ) as unknown as Record<string, unknown>;
  expect(assistant.reasoning_content).toBe(thinking);
  expect(assistant.tool_calls).toHaveLength(1);
  expect(converted.at(-1)?.role).toBe("tool");
});
