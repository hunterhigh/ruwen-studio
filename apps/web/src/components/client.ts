let token: Promise<string> | undefined;
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
export async function request<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  if (method !== "GET") {
    token ??= fetch("/api/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data: { token: string }) => data.token);
    headers.set("x-csrf-token", await token);
  }
  if (
    options.body &&
    typeof options.body === "string" &&
    !headers.has("content-type")
  )
    headers.set("content-type", "application/json");
  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 403) token = undefined;
    const value =
      data && typeof data === "object" && "error" in data
        ? data.error
        : undefined;
    if (
      value &&
      typeof value === "object" &&
      "message" in value &&
      typeof value.message === "string"
    )
      throw new ApiError(
        value.message,
        "code" in value && typeof value.code === "string"
          ? value.code
          : undefined,
        data,
      );
    throw new ApiError(
      typeof value === "string" ? value : "请求未完成，请重试。",
    );
  }
  return data as T;
}
export const post = <T = unknown>(url: string, value: unknown = {}) =>
  request<T>(url, { method: "POST", body: JSON.stringify(value) });
