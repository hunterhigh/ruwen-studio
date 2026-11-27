"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { signInCopy as copy } from "../copy/zh-CN.ts";
import { Button } from "../ui/Button.tsx";
import { BookCover } from "./BookCover.tsx";
import { ApiError, post, request } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import {
  previewProblem,
  type SignInFields,
  type SignInProblem,
  sendLogin,
  validateSignIn,
} from "./sign-in/sign-in-request.ts";

const initialFields: SignInFields = { email: "", name: "", invitationCode: "" };
const fields = [
  {
    key: "email",
    at: "email",
    label: copy.email,
    placeholder: copy.emailPlaceholder,
    autoComplete: "email",
  },
  {
    key: "name",
    at: "name",
    label: copy.name,
    placeholder: copy.namePlaceholder,
    autoComplete: "nickname",
  },
  {
    key: "invitationCode",
    at: "invitation",
    label: copy.invitation,
    placeholder: copy.invitationPlaceholder,
    autoComplete: "off",
  },
] as const;

function SignInNotice({
  problem,
  at,
}: {
  problem: SignInProblem | undefined;
  at: SignInProblem["at"];
}) {
  return problem?.at === at ? (
    <p id={`signin-error-${at}`} className="signin-error" role="alert">
      {problem.text}
    </p>
  ) : null;
}

export function SignIn({
  preview,
  google,
  linkMinutes,
}: {
  preview: boolean;
  google: boolean;
  linkMinutes: number;
}) {
  const [input, setInput] = useState(initialFields);
  const [sentTo, setSentTo] = useState("");
  const [problem, setProblem] = useState<SignInProblem>();
  const [pending, setPending] = useState<"send" | "preview" | "google">();
  const [ready, setReady] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const restoreEmailFocus = useRef(false);

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (sentTo) sentHeading.current?.focus();
    else if (restoreEmailFocus.current) {
      restoreEmailFocus.current = false;
      form.current?.querySelector("input")?.focus();
    }
  }, [sentTo]);

  function showProblem(next: SignInProblem) {
    setProblem(next);
    const field = fields.find(({ at }) => at === next.at);
    if (field)
      form.current
        ?.querySelector<HTMLInputElement>(`#signin-${field.at}`)
        ?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    const data = {
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      invitationCode: input.invitationCode.trim(),
    };
    const invalid = validateSignIn(data);
    if (invalid) return showProblem(invalid);
    setProblem(undefined);
    setPending("send");
    try {
      const failure = await sendLogin(data);
      if (failure) showProblem(failure);
      else setSentTo(data.email);
    } catch {
      setProblem(copy.errors.sendFailed);
    } finally {
      setPending(undefined);
    }
  }

  function editEmail() {
    setProblem(undefined);
    restoreEmailFocus.current = true;
    setInput((current) => ({ ...current, email: "" }));
    setSentTo("");
  }

  async function openPreview() {
    setProblem(undefined);
    setPending("preview");
    try {
      const mail = await request<{ url: string }>("/api/preview/mail");
      window.location.assign(mail.url);
    } catch (error) {
      setProblem(
        previewProblem(error instanceof ApiError ? error.status : undefined),
      );
    } finally {
      setPending(undefined);
    }
  }

  async function googleLogin() {
    setProblem(undefined);
    setPending("google");
    try {
      const result = await post<{ url: string }>("/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: "/projects",
      });
      window.location.assign(result.url);
    } catch {
      setProblem(copy.errors.googleFailed);
    } finally {
      setPending(undefined);
    }
  }

  return (
    <main className="signin-page">
      <section className="signin-story" aria-labelledby="signin-motto">
        <span className="signin-wordmark">{copy.brand}</span>
        <div className="signin-story-body">
          <div className="signin-cover">
            <BookCover id="ruwen-sign-in" title={copy.brand} />
          </div>
          <p className="signin-motto" id="signin-motto">
            {copy.motto}
          </p>
          <ol>
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>
      <section className="signin-access" aria-labelledby="signin-title">
        <div className="signin-content">
          <h1 id="signin-title">{copy.heading}</h1>
          {sentTo ? (
            <div className="signin-sent">
              <h2 ref={sentHeading} tabIndex={-1}>
                {copy.sentHeading}
              </h2>
              <output className="signin-sent-status">
                <span className="signin-sent-address">
                  <span>{copy.sentTo}</span>
                  <SafeMarkdown plain inline content={sentTo} />
                </span>
                <span>{copy.linkInstructions(linkMinutes)}</span>
              </output>
              <div className="signin-sent-actions">
                {preview && (
                  <Button
                    variant="primary"
                    disabled={Boolean(pending)}
                    onClick={() => void openPreview()}
                  >
                    {pending === "preview"
                      ? copy.openingPreview
                      : copy.previewMail}
                  </Button>
                )}
                <SignInNotice problem={problem} at="preview" />
                <Button
                  variant="ghost"
                  className="signin-text-button"
                  onClick={editEmail}
                  disabled={Boolean(pending)}
                >
                  {copy.changeEmail}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="signin-intro">{copy.intro}</p>
              <form
                ref={form}
                action="/api/login"
                method="post"
                noValidate
                onSubmit={submit}
              >
                {fields.map((field) => {
                  const isEmail = field.key === "email";
                  const invalid = problem?.at === field.at;
                  return (
                    <div className="signin-field" key={field.key}>
                      <label htmlFor={`signin-${field.at}`}>
                        <span>
                          {field.label}
                          {field.key === "name" && (
                            <small>{copy.optional}</small>
                          )}
                        </span>
                      </label>
                      <input
                        id={`signin-${field.at}`}
                        name={field.key}
                        type={isEmail ? "email" : "text"}
                        autoComplete={field.autoComplete}
                        required={isEmail}
                        value={input[field.key]}
                        placeholder={field.placeholder}
                        aria-invalid={invalid || undefined}
                        aria-describedby={
                          invalid ? `signin-error-${field.at}` : undefined
                        }
                        readOnly={pending === "send"}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setInput((current) => ({
                            ...current,
                            [field.key]: value,
                          }));
                          if (invalid) setProblem(undefined);
                        }}
                      />
                      <SignInNotice problem={problem} at={field.at} />
                    </div>
                  );
                })}
                <div className="signin-submit">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!ready || Boolean(pending)}
                  >
                    {pending === "send" ? copy.submitting : copy.submit}
                  </Button>
                  <SignInNotice problem={problem} at="submit" />
                </div>
              </form>
              {google && (
                <div className="signin-google">
                  <p className="signin-divider">{copy.alternative}</p>
                  <Button
                    disabled={!ready || Boolean(pending)}
                    onClick={() => void googleLogin()}
                  >
                    {pending === "google" ? copy.openingGoogle : copy.google}
                  </Button>
                  <SignInNotice problem={problem} at="google" />
                </div>
              )}
            </>
          )}
          {preview && <p className="signin-preview-note">{copy.previewNote}</p>}
        </div>
      </section>
    </main>
  );
}
