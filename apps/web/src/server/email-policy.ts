import { domainToASCII } from "node:url";
import { runtimeSettings } from "../../../../config/settings.ts";
export function disposableEmail(email: string) {
  const normalized = email.trim();
  const domain = domainToASCII(
    normalized.slice(normalized.lastIndexOf("@") + 1),
  )
    .toLowerCase()
    .replace(/\.$/, "");
  return runtimeSettings().riskReview.disposableEmailDomains.some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}
