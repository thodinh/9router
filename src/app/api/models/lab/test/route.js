import { NextResponse } from "next/server";
import { startSweep, getSweepSnapshot } from "@/lib/modelLab/sweep.js";

export const dynamic = "force-dynamic";

// POST /api/models/lab/test  body: { providers?: string[], maxModelsPerProvider?: number }
// Starts (or attaches to an already-running) sweep in the background. Progress
// is streamed over GET /api/models/lab/test/stream.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const providers = Array.isArray(body.providers) && body.providers.length
      ? body.providers.filter(Boolean)
      : undefined;
    const res = await startSweep({ providers, maxModelsPerProvider: body.maxModelsPerProvider });
    return NextResponse.json({ ...res, ...getSweepSnapshot() });
  } catch (error) {
    console.log("[modelLab] POST /api/models/lab/test failed:", error);
    return NextResponse.json({ error: "Failed to start model tests", detail: error?.message || String(error) }, { status: 500 });
  }
}