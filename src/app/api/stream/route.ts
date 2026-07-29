import { getCurrentUser } from "@/lib/auth/session";
import { recentEvents, subscribe, type WatchmanEvent } from "@/lib/events/bus";

/**
 * Server-sent events feeding the live tape.
 *
 * SSE rather than WebSockets: the traffic is strictly one-directional, and SSE
 * needs no upgrade handshake, no library on either end, and reconnects on its own
 * when a laptop wakes from sleep.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // The tape names monitors and their failure reasons, so it is behind auth like
  // everything else in the dashboard.
  if (!(await getCurrentUser())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: WatchmanEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The client vanished between the abort signal and this write.
          closed = true;
        }
      };

      // Replay the buffer so a freshly loaded dashboard has history immediately,
      // instead of an empty tape until the next check fires.
      for (const event of recentEvents(30)) send(event);

      const unsubscribe = subscribe(send);

      /*
       * A comment frame every 20 seconds. Proxies and load balancers commonly kill
       * an idle connection after 30-60s, and on a fleet with long intervals the
       * stream is legitimately silent for minutes at a time.
       */
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closed = true;
        }
      }, 20_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells nginx not to buffer the response, which would defeat the point.
      "x-accel-buffering": "no",
    },
  });
}
