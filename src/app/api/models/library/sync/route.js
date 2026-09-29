import { NextResponse } from "next/server";
import { syncCatalogAll } from "@/lib/modelLab/catalog.js";
import { getCatalogStats } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

// POST /api/models/library/sync  → (re)sync the model library catalog now.
export async function POST() {
  try {
    const result = await syncCatalogAll();
    const stats = await getCatalogStats();
    return NextResponse.json({ ok: true, ...result, count: stats.count });
  } catch (error) {
    console.log("[modelLab] POST /api/models/library/sync failed:", error);
    return NextResponse.json({ error: "Failed to sync model library", detail: error?.message || String(error) }, { status: 500 });
  }
}