let token: Promise<string> | undefined;
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
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "请求未完成，请重试。",
    );
  }
  return data as T;
}
export const post = <T = unknown>(url: string, value: unknown = {}) =>
  request<T>(url, { method: "POST", body: JSON.stringify(value) });
