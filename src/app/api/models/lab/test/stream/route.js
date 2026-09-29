import { getSweepSnapshot, subscribeSweep } from "@/lib/modelLab/sweep.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/models/lab/test/stream → SSE: emits the current sweep snapshot, then
// every sweep event ({kind:'start'|'plan'|'item'|'done', ...}) until the client
// disconnects. Keeps the connection alive with `: ping` comments.
export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null };

  const stream = new ReadableStream({
    start(controller) {
      const push = (event) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          state.closed = true;
        }
      };
      push({ kind: "snapshot", ...getSweepSnapshot() });
      controller._unsub = subscribeSweep(push);
      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          return;
        }
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { state.closed = true; }
      }, 25000);
    },
    cancel(controller) {
      state.closed = true;
      clearInterval(state.keepalive);
      if (typeof controller?._unsub === "function") controller._unsub();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}