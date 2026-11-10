"use client";
import { type FormEvent, useEffect, useState } from "react";
import { post, request } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
export function SignIn({
  preview,
  google,
}: {
  preview: boolean;
  google: boolean;
}) {
  const [error, setError] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await post("/api/login", {
        email: data.get("email"),
        name: data.get("name"),
        invitationCode: data.get("invitation"),
      });
      setSent(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mailbox() {
    setError("");
    try {
      const mail = await request<{ url: string }>("/api/preview/mail");
      window.location.assign(mail.url);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function googleLogin() {
    setError("");
    try {
      const result = await post<{ url: string }>("/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: "/projects",
      });
      window.location.assign(result.url);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <main className="sign-in">
      <section className="welcome">
        <div className="wordmark">
          如文<span>STUDIO</span>
        </div>
        <span className="eyebrow">写作，由你做最后的决定</span>
        <h1>
          让故事发生。
          <br />
          把决定留给自己。
        </h1>
        <p>
          独立的作者、读者、编辑与核验岗位，
          <br />
          共同完成一份等待你阅读的候选稿。
        </p>
        <div className="welcome-note">
          <span>构思</span>
          <i />
          <span>正文</span>
          <i />
          <span>阅读</span>
          <i />
          <span>确认</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-heading">
          <span className="eyebrow">进入工作室</span>
          <h2>从一封登录邮件开始</h2>
          <p>无需密码。新账户需要邀请码。</p>
        </div>
        <form method="post" action="/api/login" onSubmit={submit}>
          <label>
            邮箱
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <label>
            如何称呼你
            <input name="name" autoComplete="name" placeholder="笔名（可选）" />
          </label>
          <label>
            邀请码
            <input
              name="invitation"
              autoComplete="off"
              placeholder="已有账户可留空"
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !ready}
            type="submit"
          >
            {busy ? "正在发送…" : "发送登录链接"}
          </button>
        </form>
        {sent && (
          <output className="notice" aria-live="polite">
            登录链接已发送，请在有效期内打开。
            {preview && (
              <button type="button" className="text-button" onClick={mailbox}>
                打开本浏览器的预览邮件
              </button>
            )}
          </output>
        )}
        {error && (
          <div className="error" role="alert">
            <SafeMarkdown plain content={error} />
          </div>
        )}
        <div className="login-divider">或</div>
        <button
          className="button secondary"
          disabled={!google || busy || !ready}
          type="button"
          onClick={googleLogin}
        >
          使用 Google 登录{google ? "" : " · 待配置"}
        </button>
        <p className="fine-print">
          {preview
            ? "本地模拟预览，不验证真实邮箱所有权。预览邮件仅供本机试用，生产环境不可用。"
            : "登录链接仅发送到你的邮箱。请勿转发给他人。"}
        </p>
      </section>
    </main>
  );
}
