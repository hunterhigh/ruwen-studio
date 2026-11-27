import { signInCopy as copy } from "../../copy/zh-CN.ts";
import { request } from "../client.ts";

export type SignInFields = {
  email: string;
  name: string;
  invitationCode: string;
};

type ErrorName = keyof typeof copy.errors;
export type SignInProblem = {
  at: (typeof copy.errors)[ErrorName]["at"];
  text: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveSeconds(value: unknown) {
  const seconds =
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value))
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function retrySeconds(
  header: string | null,
  body: Record<string, unknown> | undefined,
  now: number,
) {
  if (header && !/^\d+$/.test(header)) {
    const delay = Math.ceil((Date.parse(header) - now) / 1000);
    if (delay > 0) return delay;
  }
  return (
    positiveSeconds(header) ??
    positiveSeconds(body?.retryAfterSeconds) ??
    positiveSeconds(asRecord(body?.error)?.retryAfterSeconds)
  );
}

export function loginProblem(
  status: number,
  payload?: unknown,
  retryAfter: string | null = null,
  now = Date.now(),
): SignInProblem {
  const body = asRecord(payload);
  const error = asRecord(body?.error);
  if (status === 429 || error?.code === "RATE_LIMITED") {
    const delay = retrySeconds(retryAfter, body, now);
    return {
      ...copy.errors.rateLimited,
      text: delay ? copy.rateLimitedWait(delay) : copy.errors.rateLimited.text,
    };
  }
  const message = error?.message ?? body?.error;
  const exact = copy.loginMessages.find(
    ([code, raw]) => code === status && raw === message,
  );
  if (exact) return copy.errors[exact[2]];
  const fallback = copy.loginStatusErrors.find(([code]) => code === status);
  return copy.errors[fallback?.[1] ?? "sendFailed"];
}

export function previewProblem(status?: number): SignInProblem {
  const match = copy.previewStatusErrors.find(([code]) => code === status);
  return copy.errors[match?.[1] ?? "previewFailed"];
}

export function validateSignIn({
  email,
  name,
}: SignInFields): SignInProblem | undefined {
  if (
    Array.from(email).length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    return copy.errors.email;
  if (Array.from(name).length > 80) return copy.errors.name;
}

export async function sendLogin(
  fields: SignInFields,
): Promise<SignInProblem | undefined> {
  const { token } = await request<{ token: string }>("/api/csrf");
  // The shared JSON client exposes the error body. Login also needs Retry-After when present.
  const response = await fetch("/api/login", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-csrf-token": token },
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    return loginProblem(
      response.status,
      payload,
      response.headers.get("Retry-After"),
    );
  }
}
