import { setTimeout as delay } from "node:timers/promises";
import type {
  IdeationActor,
  IdeationCursor,
  IdeationResult,
  IdeationService,
  IdeationSessionId,
} from "./contract.ts";
import { ideationError } from "./sessions.ts";

/** HTTP adapter: caller retains CSRF/auth/requireOwnership and registers its route in API_ROUTES.
 * Authentication is refreshed on every poll, not captured once when the connection starts. */
export async function ideationSse(
  service: Pick<IdeationService, "listIdeationEvents">,
  authenticate: () => Promise<IdeationActor | null>,
  request: {
    sessionId: IdeationSessionId;
    after?: IdeationCursor;
    lastEventId?: string | null;
    signal?: AbortSignal;
    pollMs?: number;
  },
): Promise<IdeationResult<Response>> {
  const actor = await authenticate();
  if (!actor) return { ok: false, error: ideationError("UNAUTHENTICATED") };
  let after = (request.lastEventId ?? request.after ?? "0") as IdeationCursor;
  const initial = await service.listIdeationEvents(actor, {
    sessionId: request.sessionId,
    after,
  });
  if (!initial.ok) return initial;
  const control = new AbortController();
  const signal = request.signal
    ? AbortSignal.any([request.signal, control.signal])
    : control.signal;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (signal.aborted) {
            controller.close();
            return;
          }
          const current = await authenticate();
          if (
            !current ||
            current.userId !== actor.userId ||
            current.projectId !== actor.projectId
          ) {
            controller.close();
            return;
          }
          // Fresh ownership check before sending even the first previously fetched batch.
          const page = await service.listIdeationEvents(current, {
            sessionId: request.sessionId,
            after,
            limit: 1,
          });
          if (!page.ok) {
            controller.close();
            return;
          }
          const event = page.value.items[0];
          if (event) {
            if (signal.aborted) {
              controller.close();
              return;
            }
            controller.enqueue(
              encoder.encode(
                `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            after = event.id;
          } else {
            await delay(request.pollMs ?? 250, undefined, { signal });
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        } catch {
          /* Disconnect and authentication/DB failure end the stream without exception text. */
          if (!control.signal.aborted) controller.close();
        }
      },
      cancel() {
        control.abort();
      },
    },
    { highWaterMark: 0 },
  );
  return {
    ok: true,
    value: new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    }),
  };
}
