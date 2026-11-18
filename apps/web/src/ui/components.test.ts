import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { uiCopy } from "../copy/zh-CN.ts";
import { Button } from "./Button.tsx";
import { ConfirmDialog, ConfirmProvider } from "./ConfirmDialog.tsx";
import { KeyValueList } from "./KeyValueList.tsx";
import { RoleDot, RoleTag } from "./Role.tsx";
import { SealButton } from "./SealButton.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { Toast, ToastProvider } from "./Toast.tsx";

describe("visual system rendering", () => {
  it("renders each Button variant and retains native disabled semantics", () => {
    for (const variant of [
      "primary",
      "secondary",
      "ghost",
      "danger-text",
    ] as const) {
      expect(render(h(Button, { variant, disabled: true }, "操作"))).toContain(
        `ui-btn-${variant}`,
      );
    }
    expect(render(h(Button, { disabled: true }, "操作"))).toMatch(
      /type="button".*disabled=""/,
    );
  });
  it("renders an approval seal with a decorative glyph", () => {
    const html = render(h(SealButton, { disabled: true }, "批准正文"));
    expect(html).toContain("disabled");
    expect(html).toContain('aria-hidden="true">准</span>');
    expect(html).toContain("批准正文");
  });
  it("renders all StatusBadge tones", () => {
    for (const tone of ["decide", "ok", "run", "stop"] as const) {
      expect(render(h(StatusBadge, { tone }, "状态"))).toContain(
        `ui-status-${tone}`,
      );
    }
  });
  it("renders a labelled native dialog with cancel before confirm", () => {
    const html = render(
      h(ConfirmDialog, { title: "确认？", body: "说明", onConfirm: () => {} }),
    );
    expect(html).toContain("<dialog");
    expect(html).toContain("aria-labelledby=");
    expect(html.indexOf(uiCopy.cancel)).toBeLessThan(
      html.indexOf('type="submit"'),
    );
    expect(render(h(ConfirmProvider, null, "内容"))).toBe("内容");
  });
  it("renders an accessible Toast without requiring a provider", () => {
    expect(render(h(Toast, { message: "已保存" }))).toContain("<output");
    expect(render(h(ToastProvider, null, "内容"))).toBe("内容");
  });
  it("renders RoleDot colors and RoleTag names, including ideation and unknown roles", () => {
    expect(render(h(RoleDot, { role: "wenxue-bianji" }))).toContain(
      "ui-role-editor",
    );
    expect(render(h(RoleTag, { role: "qinggan-duzhe" }))).toContain("情感读者");
    expect(render(h(RoleTag, { role: "chuangyi-xietiaoyuan" }))).toContain(
      "创意协调员",
    );
    expect(render(h(RoleTag, { role: "__proto__" }))).toContain("其他岗位");
  });
  it("renders nested KeyValueList fields safely and folds unknown fields", () => {
    const html = render(
      h(KeyValueList, {
        value: {
          title: "<script>坏内容</script>",
          status: "DONE",
          patches: [{ kind: "fact", pass: true }],
          unknown_internal: "文字",
        },
      }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("已完成");
    expect(html).toContain("事实修正");
    expect(html).toContain("<details><summary>其他</summary>");
    expect(html).not.toContain("unknown_internal");
    expect(html).not.toContain("DONE");
  });
});
