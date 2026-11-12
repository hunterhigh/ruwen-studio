import {
  defaultFauxResponse,
  requestRole,
} from "../../packages/agents/src/faux.ts";
import { unescapeTaggedMaterial } from "../../packages/agents/src/messages.ts";
import type { Data } from "../../packages/agents/src/types.ts";

const sample =
  "他在石阶前放慢脚步，她却以为他要结束散步，先把手收了回去。他忙指向前方的花，话说得太快，竟问她愿不愿意再看一次昨天的花。她抿着嘴问，花难道还认得昨天的客人。他伸手去扶一片叶子，袖扣却挂住枝条。她笑出了声，又立刻装作在看水面。他听见笑声，也跟着松了一口气。两人都以为对方已经明白自己的意思，转过回廊时，却不约而同地换了个话题。";
const field =
  "午后的花园里，两位成年人物沿着石阶散步，彼此尚未把心意说清。衣饰和称呼带来的距离正在变化，话语可以被当成另一种意思，一次抬手或停步也可能让期待偏离。眼前的光、水声与回廊不断改变两人并肩的位置；另一人的内心不能被直接得知，接下来的回答与误会怎样延续仍没有确定的结果。";
/** Illustrative LOCAL responses for tool validation/budget planning, never a prediction of live prose. */
export function customSmokeReplies() {
  let conversations = 0;
  return (
    context: Parameters<typeof defaultFauxResponse>[0],
  ): ReturnType<typeof defaultFauxResponse> => {
    const role = requestRole(context),
      response = defaultFauxResponse(context);
    if (role === "chuangyi-xietiaoyuan" && conversations++ === 0)
      return {
        ...response,
        content: [
          {
            type: "text",
            text: "可以先确认这次会面的关系变化，再交接故事资料。",
          },
        ],
        stopReason: "stop",
      };
    const call = response.content.find((b) => b.type === "toolCall");
    if (role === "xiaoshuo-zuozhe")
      return { ...response, content: [{ type: "text", text: sample }] };
    if (!call || call.type !== "toolCall") return response;
    if (role === "chuangyi-xietiaoyuan")
      call.arguments.resource_ids = ["gushi-dangqian-hu"];
    if (role === "gushi-gousishi") {
      let resource: Data | undefined;
      for (const message of context.messages) {
        if (
          message.role !== "toolResult" ||
          message.toolName !== "read_resource"
        )
          continue;
        for (const block of message.content)
          if (block.type === "text") {
            try {
              const value = JSON.parse(unescapeTaggedMaterial(block.text));
              if (value.id === "gushi-dangqian-hu") resource = value;
            } catch {
              /* only actual tool results are material */
            }
          }
      }
      if (!resource) {
        call.name = "read_resource";
        call.arguments = { id: "gushi-dangqian-hu" };
      } else
        call.arguments = {
          summary: "会面中的期待和误解尚未得到答复。",
          locked_events: [],
          open_questions: ["双方如何解释对方的回应仍开放。"],
          patches: [],
          new_files: [
            {
              resource_id: "custom-story-meeting",
              path: "故事/本章相遇.md",
              type: "story",
              content:
                "# 本章相遇\n\n两位成年人物在一次会面中重新试探关系的距离，身份变化使靠近成为现实的可能。轻巧的话语与相互误解并存，场景尚未替他们解决所有疑问。\n",
            },
          ],
        };
    }
    if (role === "zhangjie-qingjing-bianyiyuan")
      call.arguments.generation_field = field;
    if (role === "qinggan-duzhe")
      for (const reaction of call.arguments.reactions as Data[])
        reaction.note = "我注意到他想解释却又换了话题。";
    if (role === "jiyi-weihuyuan" && call.name !== "read_resource")
      Object.assign(call.arguments, {
        new_facts: ["两人进行了一次会面。"],
        next_chapter_state: "尚未说清的心意与误解仍在继续。",
        patches: [],
      });
    return response;
  };
}
