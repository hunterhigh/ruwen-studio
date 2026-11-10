import { newMailbox, previewMail } from "../src/server/auth.ts";
import { hash } from "../src/server/security.ts";
import type { WebServices } from "../src/server/services.ts";
/** Actual magic-link authentication against the fixture database; never mocks identity or session checks. */
export async function loginFixture(
  services: WebServices,
  email: string,
  previousCookie = "",
) {
  const mailbox = newMailbox();
  await services.auth.api.signInMagicLink({
    headers: new Headers({ origin: services.environment.baseURL }),
    body: {
      email,
      callbackURL: "/projects",
      metadata: { previewMailbox: hash(mailbox) },
    },
  });
  const mail = await previewMail(services.environment, mailbox);
  const verified = await services.auth.handler(
    new Request(mail.url, { headers: { cookie: previousCookie } }),
  );
  if (verified.status !== 302)
    throw new Error("Fixture login verification failed");
  return {
    cookie: verified.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
    url: mail.url,
  };
}
