import { NextResponse } from "next/server";
import { setModelRating } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

// POST /api/models/lab/rating  { provider, model, kind?, rating }
// rating 1-5 sets the star rating; rating 0 clears it.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const provider = String(body.provider || "");
    const model = String(body.model || "");
    const kind = String(body.kind || "llm");
    const rating = Math.round(Number(body.rating));
    if (!provider || !model) {
      return NextResponse.json({ error: "provider and model are required" }, { status: 400 });
    }
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      return NextResponse.json({ error: "rating must be an integer 0-5" }, { status: 400 });
    }
    const saved = await setModelRating({ provider, model, kind, rating });
    return NextResponse.json(saved);
  } catch (error) {
    console.log("[modelLab] POST /api/models/lab/rating failed:", error);
    return NextResponse.json({ error: "Failed to save rating", detail: error?.message || String(error) }, { status: 500 });
  }
}