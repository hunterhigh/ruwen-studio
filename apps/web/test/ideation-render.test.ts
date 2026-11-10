import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { IdeationErrorNotice } from "../src/components/IdeationStudio.tsx";
import {
  errorCopy,
  type IdeationUiErrorCode,
} from "../src/components/ideation/copy.ts";

it("every contract error has safe copy; pending billing/freeze codes have clear next steps without automatic actions", () => {
  for (const code of Object.keys(errorCopy) as IdeationUiErrorCode[]) {
    const html = renderToStaticMarkup(
      createElement(IdeationErrorNotice, { code }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(errorCopy[code]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  }
  const credits = renderToStaticMarkup(
    createElement(IdeationErrorNotice, { code: "INSUFFICIENT_CREDITS" }),
  );
  expect(credits).toContain('href="/account"');
  const frozen = renderToStaticMarkup(
    createElement(IdeationErrorNotice, { code: "ACCOUNT_FROZEN" }),
  );
  expect(frozen).toContain("等待人工复核");
  expect(frozen).not.toContain("<button");
  const disabled = renderToStaticMarkup(
    createElement(IdeationErrorNotice, { code: "BILLING_DISABLED" }),
  );
  expect(disabled).toContain("当前不会发起付款");
});
