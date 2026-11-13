import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Models,
  normalizeContext,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { runtimeSettings } from "../../../../config/settings.ts";
import { defaultFauxResponse, requestRole } from "../faux.ts";
import { decodeUserMessage } from "../messages.ts";
import type { Data, ModelRuntime } from "../types.ts";
import { forwardStream } from "./stream.ts";

export const FAUX_SCENARIOS = [
  "normal",
  "anchor_ambiguous",
  "anchor_missing",
  "edit_ratio",
  "length",
  "missing_submit",
  "plot_fail",
  "reality_fail",
  "restage",
] as const;
export type FauxScenario = (typeof FAUX_SCENARIOS)[number];
export const PREVIEW_PROSE = readFileSync(
  new URL("../../fixtures/preview-chapter.md", import.meta.url),
  "utf8",
);
function input(context: TranscriptContext): Data {
  for (const message of [...context.messages].reverse())
    if (message.role === "user") {
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((item) => item.type === "text")
              .map((item) => (item.type === "text" ? item.text : ""))
              .join("");
      const data = decodeUserMessage(content);
      if (data) return data;
    }
  return {};
}
export function createScenarioRuntime(
  options: {
    scenario?: string;
    initialDelayMs?: number;
    characterDelayMs?: number;
  } = {},
): ModelRuntime {
  const settings = runtimeSettings().faux;
  const scenario = options.scenario ?? settings.scenario;
  if (!(FAUX_SCENARIOS as readonly string[]).includes(scenario))
    throw new Error("Unknown faux scenario");
  const initialDelayMs = options.initialDelayMs ?? settings.initialDelayMs,
    characterDelayMs = options.characterDelayMs ?? settings.characterDelayMs;
  if (
    ![initialDelayMs, characterDelayMs].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new Error("Invalid faux timing");
  const provider = fauxProvider({
    models: [{ id: "ruwen-preview", maxTokens: 128000 }],
    tokenSize: { min: 1, max: 1 },
  });
  const models = createModels();
  models.setProvider(provider.provider);
  const turns = new Map<string, number>();
  provider.setResponses(
    Array.from({ length: 200 }, () => async (context, request) => {
      if (initialDelayMs)
        await delay(initialDelayMs, undefined, { signal: request?.signal });
      const role = requestRole(context),
        data = input(context);
      const turn = (turns.get(role) ?? 0) + 1;
      turns.set(role, turn);
      if (scenario === "missing_submit" && turn === 1)
        return fauxAssistantMessage(
          role === "xiaoshuo-zuozhe"
            ? "# 规划说明\n尚未给出候选正文。"
            : "这次遗漏了提交工具。",
        );
      if (role === "xiaoshuo-zuozhe")
        return fauxAssistantMessage(PREVIEW_PROSE, {
          stopReason: scenario === "length" ? "length" : "stop",
        });
      if (role === "qinggan-duzhe")
        return fauxAssistantMessage(
          fauxToolCall("submit_reading", {
            reactions: [
              {
                anchor: "林川把信封塞进内袋里",
                type: "noticed",
                note: "我先跟着他的动作确认信还在，注意随后被院里的木牌吸引。",
              },
              {
                anchor: "你送你的信",
                type: "expected",
                note: "这句话之后，我期待他会继续问粮车改道，后来他先问起了马，期待被暂时搁住。",
              },
              {
                anchor: "先让我看马",
                type: "noticed",
                note: "这里的决定很小，仍让我想接着读他如何穿过山口。",
              },
            ],
          }),
          { stopReason: "toolUse" },
        );
      if (role === "wenxue-bianji") {
        const edits =
          scenario.startsWith("anchor_") || scenario === "edit_ratio"
            ? [
                {
                  original:
                    scenario === "anchor_ambiguous"
                      ? "林川"
                      : scenario === "anchor_missing"
                        ? "他走进不存在的房间"
                        : "林川把信封塞进内袋里。",
                  replacement:
                    scenario === "edit_ratio"
                      ? "风".repeat(1000)
                      : "林川把信封放进内袋里。",
                  kind: "literary",
                  reason: "模拟局部调整的锚点与比例校验",
                },
              ]
            : [];
        return fauxAssistantMessage(
          fauxToolCall("submit_edit", {
            decision: scenario === "restage" ? "RESTAGE" : "LOCAL_EDIT",
            edits,
            problems: [
              {
                location: "那目光里没有嘲笑，只有等了太久的困倦",
                category: "explanation",
                condition: "叙述替人物解释了目光",
                handling: "保留本稿供人类审阅，未自动统一含混",
                result: "等待用户阅读",
              },
            ],
            ...(scenario === "restage"
              ? { return_reason: "场景压力需要重新构思，本次不局部续写剧情。" }
              : {}),
          }),
          { stopReason: "toolUse" },
        );
      }
      if (role === "qingjie-heyanyuan" && scenario === "plot_fail") {
        const promises = Array.isArray(data.locked_events)
          ? data.locked_events
          : [];
        return fauxAssistantMessage(
          fauxToolCall("submit_verdict", {
            pass: false,
            issues: [
              {
                promise: String(promises[0] ?? "粮车先离开"),
                problem: "order",
                evidence: "模拟核验退回：锁定顺序需要上游重新确认。",
              },
            ],
          }),
          { stopReason: "toolUse" },
        );
      }
      if (role === "xianshi-heyanyuan" && scenario === "reality_fail")
        return fauxAssistantMessage(
          fauxToolCall("submit_verdict", {
            pass: false,
            issues: [
              {
                category: "institution",
                evidence: "模拟核验退回：换马规则与身份凭证需要上游核对。",
                rule_ref: "xiaoyan-yingsheding",
              },
            ],
          }),
          { stopReason: "toolUse" },
        );
      return defaultFauxResponse(context);
    }),
  );
  const stream: Models["streamSimple"] = (model, context, request) =>
    forwardStream(
      models.streamSimple(model, normalizeContext(context), request),
      { signal: request?.signal, characterDelayMs },
    );
  const wrapped = new Proxy(models, {
    get(target, key) {
      if (key === "streamSimple") return stream;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    mode: "faux",
    models: wrapped,
    resolve: () => ({ model: provider.getModel(), thinkingLevel: "off" }),
  };
}
