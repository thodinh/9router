import { NextResponse } from "next/server";
import { getFreeReport, approveFreeModel } from "@/lib/modelLab/freeHunter.js";

export const dynamic = "force-dynamic";

// GET /api/models/free → Free-hunter report: price-0 candidates from the
// synced catalog, freeTier provider packs, live quota balances, free-combo state.
export async function GET() {
  try {
    const report = await getFreeReport();
    return NextResponse.json(report);
  } catch (error) {
    console.log("[freeHunter] GET failed:", error);
    return NextResponse.json({ error: "Failed to build free report", detail: error?.message || String(error) }, { status: 500 });
  }
}

// POST /api/models/free  body: { action: "approve", provider, model }
// Approve = enable the model in the lab and add it to the `free` combo.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action !== "approve") {
      return NextResponse.json({ error: 'action "approve" required' }, { status: 400 });
    }
    if (!body.provider || !body.model) {
      return NextResponse.json({ error: "provider and model required" }, { status: 400 });
    }
    const result = await approveFreeModel(String(body.provider), String(body.model));
    return NextResponse.json(result);
  } catch (error) {
    console.log("[freeHunter] POST failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to approve model" }, { status: 500 });
  }
}
