import { NextResponse } from "next/server";
import { syncProviderDrift, syncAllProvidersDrift } from "@/lib/modelLab/drift.js";

export const dynamic = "force-dynamic";

// POST /api/models/lab/drift  body: { provider?: string }
// With provider: sync drift for just that provider. Without: sync all providers
// that have connections. Always sequential (live fetches are credential-scoped).
export async function POST(request) {
  try {
    const { provider } = await request.json().catch(() => ({}));
    const results = provider
      ? [await syncProviderDrift(provider)]
      : await syncAllProvidersDrift();
    return NextResponse.json({ results });
  } catch (error) {
    console.log("[modelLab] POST /api/models/lab/drift failed:", error);
    return NextResponse.json({ error: "Failed to sync drift", detail: error?.message || String(error) }, { status: 500 });
  }
}