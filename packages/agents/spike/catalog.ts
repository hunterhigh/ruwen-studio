import { writeFileSync } from "node:fs";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

// Static package catalogs only: no credential lookup, refresh or model requests.
const catalog = {
  piVersion: "1.5.0",
  source:
    "installed provider.getModels() (static catalogs; API availability unverified)",
  providers: [anthropicProvider(), openaiProvider(), deepseekProvider()].map(
    (provider) => ({
      provider: provider.id,
      models: provider.getModels().map((model) => ({
        id: model.id,
        api: model.api,
        thinkingLevels: getSupportedThinkingLevels(model),
        ...(provider.id === "deepseek"
          ? {
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
              cost: model.cost,
              toolCalls: true,
              capabilitySource:
                "installed openai-completions adapter; offline serializer verified; live availability unverified",
              compat: model.compat,
            }
          : {}),
      })),
    }),
  ),
};

writeFileSync(
  new URL("../../../config/model-catalog.json", import.meta.url),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
