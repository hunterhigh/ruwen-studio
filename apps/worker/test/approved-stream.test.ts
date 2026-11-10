import { createFauxRuntime } from "@ruwen/agents";
import { expect, it } from "vitest";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { forwardStream } from "../../../packages/agents/src/runtime/stream.ts";
import { deploymentCanary } from "../../../packages/agents/src/security/notes.ts";
import { handleApi } from "../../web/src/server/api.ts";
import { createWebAuth } from "../../web/src/server/auth.ts";
import type { WebServices } from "../../web/src/server/services.ts";
import { loginFixture } from "../../web/test/auth-fixture.ts";
import { fixture } from "./helpers.ts";

it("worker SQL and live/replayed SSE receive only released onDelta text, never raw thinking or a rejected model tail", async () => {
  const safePrefix =
    "石阶上的雪已经扫净，少年把木桶靠在门边，等驿卒从院子里出来。他先看了一眼缰绳，又把手放回衣袋。\n".repeat(
      3,
    );
  const canary = deploymentCanary(),
    thinking = "RAW_PROVIDER_THINKING_ONLY_721b",
    signature = "RAW_PROVIDER_SIGNATURE_ONLY_721b";
  const runtime = createFauxRuntime([
    (context) => ({
      ...defaultFauxResponse(context),
      content: [
        {
          type: "thinking",
          thinking: `${thinking} ${canary}`,
          thinkingSignature: signature,
        },
        { type: "text", text: safePrefix },
        { type: "text", text: canary },
      ],
      stopReason: "stop",
    }),
  ]);
  const original = runtime.models.streamSimple.bind(runtime.models);
  let release = () => {},
    providerAtEnd = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.models.streamSimple = (model, context, options) =>
    forwardStream(original(model, context, options), {
      finish: async () => {
        providerAtEnd = true;
        await gate;
      },
    });
  const p = await fixture({ runtime: () => runtime });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let running: ReturnType<typeof p.service.handle> | undefined;
  try {
    const email = (
      await p.service.db.pool.query<{ email: string }>(
        "SELECT email FROM users WHERE id=$1",
        [p.fs.ownerId],
      )
    ).rows[0]?.email;
    if (!email) throw new Error("Missing fixture user");
    const environment = {
      baseURL: "https://localhost:3000",
      secret: "approved-stream-test-".repeat(3),
      workspaceRoot: ".",
      preview: true,
    };
    const services: WebServices = {
      worker: p.service,
      auth: createWebAuth(p.service.db, environment),
      environment,
      adminEmails: [],
      ipProofSecret: "test",
    };
    const login = await loginFixture(services, email);
    const id = await p.service.enqueueChapter(p.fs, { chapter: 1 });
    let finished = false;
    running = p.service
      .handle({
        kind: "chapter",
        projectId: p.fs.projectId,
        ownerId: p.fs.ownerId,
        runId: id,
      })
      .finally(() => {
        finished = true;
      });
    await expect.poll(() => providerAtEnd).toBe(true);
    const persisted = async () =>
      (
        await p.service.db.pool.query<{ delta: string }>(
          "SELECT delta FROM web_run_events WHERE run_id=$1 ORDER BY id",
          [id],
        )
      ).rows
        .map((row) => row.delta)
        .join("");
    await expect.poll(persisted).not.toBe("");
    const approved = await persisted();
    expect(finished).toBe(false); // The provider has sent its raw tail but has not completed its message.
    expect(safePrefix.startsWith(approved)).toBe(true);
    expect(approved).not.toContain(canary);
    expect(approved).not.toContain(thinking);
    expect(approved).not.toContain(signature);
    const request = () =>
      new Request(`${environment.baseURL}/api/runs/${id}/events`, {
        headers: { cookie: login.cookie },
      });
    const live = await handleApi(request(), services);
    expect(live.status).toBe(200);
    reader = live.body?.getReader();
    if (!reader) throw new Error("Missing SSE response body");
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("event: delta");
    const delta = JSON.parse(frame.match(/^data: (.+)$/m)?.[1] ?? "{}");
    expect(delta).toEqual({ role: "xiaoshuo-zuozhe", text: approved });
    await reader.cancel();
    reader = undefined;
    release();
    expect((await running)?.status).toBe("FAILED");
    expect(await persisted()).toBe(approved); // A failed final message cannot flush its withheld tail.
    const replay = await handleApi(request(), services);
    reader = replay.body?.getReader();
    if (!reader) throw new Error("Missing replay response body");
    const replayFrame = new TextDecoder().decode((await reader.read()).value);
    expect(replayFrame).toBe(frame);
    for (const secret of [canary, thinking, signature])
      expect(replayFrame).not.toContain(secret);
  } finally {
    await reader?.cancel();
    release();
    try {
      await running;
    } finally {
      await p.service.stop();
    }
  }
}, 30000);
