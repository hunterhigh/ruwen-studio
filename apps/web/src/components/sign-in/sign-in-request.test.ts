import { describe, expect, it } from "vitest";
import { signInCopy as copy } from "../../copy/zh-CN.ts";
import {
  loginProblem,
  previewProblem,
  validateSignIn,
} from "./sign-in-request.ts";

describe("login response copy", () => {
  it.each([
    [400, "请填写有效邮箱。", "email", "请填写完整的邮箱地址。"],
    [
      400,
      "请填写有效内容。",
      "invitation",
      "请填写有效的邀请码。已有账户可以留空。",
    ],
    [
      400,
      "邀请码无效或已用完。",
      "invitation",
      "此邀请码无效或已用完。请核对后再试。",
    ],
    [
      400,
      "请求正文必须是有效的JSON对象。",
      "submit",
      "请核对填写的内容后再发送。",
    ],
    [
      403,
      "暂不支持此邮箱服务，请使用常用邮箱。",
      "email",
      "暂不支持此邮箱服务。请换用常用邮箱。",
    ],
    [
      403,
      "请求来源不被允许，请从工作室页面重试。",
      "submit",
      "请在如文登录页重新发送邮件。",
    ],
    [
      403,
      "请求校验已失效，请刷新页面后重试。",
      "submit",
      "登录页的校验已过期。请刷新后重试。",
    ],
    [413, "文件或请求正文过大。", "submit", "填写的内容太长。请缩短后重试。"],
    [404, "接口不存在。", "submit", "暂时发不出登录邮件。请稍后再试。"],
    [
      500,
      "untrusted internal message",
      "submit",
      "暂时发不出登录邮件。请稍后再试。",
    ],
  ])("maps HTTP %s and %s to a nearby user-facing error", (status, error, at, text) => {
    expect(loginProblem(status, { error })).toEqual({ at, text });
  });

  it("shows a generic rate-limit hint when the server provides no usable wait", () => {
    expect(loginProblem(429, { error: "登录请求过多，请稍后再试。" })).toEqual(
      copy.errors.rateLimited,
    );
    expect(loginProblem(429, { retryAfterSeconds: -10 }, "invalid")).toEqual(
      copy.errors.rateLimited,
    );
  });

  it("uses numeric and date Retry-After headers or explicit response seconds", () => {
    expect(loginProblem(429, { retryAfterSeconds: 45 }, "12")).toEqual({
      at: "submit",
      text: "发送过于频繁。请等待 12 秒后再试。",
    });
    expect(
      loginProblem(
        429,
        {},
        "Fri, 27 Nov 2026 07:01:05 GMT",
        Date.parse("2026-11-27T07:00:00Z"),
      ),
    ).toEqual({
      at: "submit",
      text: "发送过于频繁。请等待约 2 分钟后再试。",
    });
    expect(
      loginProblem(429, {
        error: { code: "RATE_LIMITED", retryAfterSeconds: 25 },
      }),
    ).toEqual({
      at: "submit",
      text: "发送过于频繁。请等待 25 秒后再试。",
    });
  });

  it("renders a missing, inaccessible or expired preview mailbox beside its action", () => {
    expect(previewProblem(404)).toEqual({
      at: "preview",
      text: "预览邮件已过期或无法打开。请返回表单重新发送。",
    });
    expect(previewProblem(500).at).toBe("preview");
    expect(previewProblem()).toEqual(copy.errors.previewFailed);
  });

  it("validates the email and pen name beside their fields and leaves invitation checks to the server", () => {
    const fields = {
      email: "reader@example.com",
      name: "",
      invitationCode: "",
    };
    expect(validateSignIn(fields)).toBeUndefined();
    expect(validateSignIn({ ...fields, email: "reader@example" })).toEqual(
      copy.errors.email,
    );
    expect(validateSignIn({ ...fields, name: "文".repeat(81) })).toEqual(
      copy.errors.name,
    );
  });
});
