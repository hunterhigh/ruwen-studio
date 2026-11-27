import { errorCopy, statusCopy } from "../copy/zh-CN.ts";

const technical = /[\p{Script=Latin}\\/\r\n<>]|\.\p{L}{1,6}\b|[0-9a-f]{16,}/iu;

/** Notices accept short Chinese prose. Backend exceptions and values are mapped before rendering. */
export function cleanErrorText(value: unknown): string {
  if (typeof value !== "string") return statusCopy.genericError;
  const message = value.trim();
  return message.length <= 240 &&
    /\p{Script=Han}/u.test(message) &&
    !technical.test(message)
    ? message
    : statusCopy.genericError;
}

export function displayError(
  code: unknown,
  fallback: string = statusCopy.genericError,
) {
  return typeof code === "string" && Object.hasOwn(errorCopy, code)
    ? errorCopy[code as keyof typeof errorCopy]
    : fallback;
}
