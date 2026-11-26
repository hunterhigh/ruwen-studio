import { expect, test } from "@playwright/test";
import { readCandidate } from "./chapter-review.ts";
import { createDemoFromShelf as createDemo, signIn } from "./helpers.ts";

test("候选稿保存后核验基准过期，只有新版哈希可批准", async ({ page }) => {
  await signIn(page);
  const project = await createDemo(page, "候选稿版本");
  const token = (await (await page.request.get("/api/csrf")).json())
    .token as string;
  const headers = { origin: new URL(page.url()).origin, "x-csrf-token": token };
  const launch = await page.request.post(`/api/projects/${project}/chapters`, {
    headers,
    data: { chapter: 1 },
  });
  expect(launch.status()).toBe(202);
  const { id } = await launch.json();
  const url = `/api/runs/${id}`;
  const detail = async () => (await page.request.get(url)).json();
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 45000 })
    .toBe("AWAITING_CANDIDATE_APPROVAL");
  const before = await detail();
  const original = before.prose as string;
  const oldSha = before.run.candidateSha256 as string;
  const addition = "他把封信重新塞回胸口。";
  const text = `${original}\n\n${addition}\n`;
  const save = await page.request.post(`${url}/candidate/revisions`, {
    headers,
    data: { baseSha256: oldSha, text },
  });
  expect(save.status()).toBe(201);
  const saved = await save.json();
  expect(saved.sha256).not.toBe(oldSha);
  const after = await detail();
  expect(after.run.verificationBasisSha256).toBe(oldSha);
  expect(after.run.candidateSha256).toBe(saved.sha256);
  expect(after.prose).toBe(text);
  const read = await page.request.get(
    `${url}/candidate/revisions/${saved.version}`,
    { headers },
  );
  expect(read.status()).toBe(200);
  expect(await read.json()).toEqual({ text });
  const approvalPath = `${url}/approve-candidate`;
  const stale = await page.request.post(approvalPath, {
    headers,
    data: { confirmed: true, expectedSha256: oldSha },
  });
  expect(stale.status()).toBe(409);

  await page.goto(`/projects/${project}/chapters?run=${id}`);
  await expect(page.locator(".chapter-paper")).toContainText(addition);
  await readCandidate(page);
  const [approval] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === approvalPath,
    ),
    page.getByRole("button", { name: "批准正文", exact: true }).click(),
  ]);
  expect(approval.request().postDataJSON()).toEqual({
    confirmed: true,
    expectedSha256: saved.sha256,
  });
  expect(approval.status()).toBe(202);
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 45000 })
    .toBe("AWAITING_MEMORY_APPROVAL");
  expect((await detail()).prose).toBe(text);
});
