import { NextResponse } from "next/server";
import { buildLabMatrix } from "@/lib/modelLab/plan.js";
import { getModelTests, getProviderDrift, getDisabledModels, getModelRatings, getModelInfoMap, getCatalogStats } from "@/lib/db/index.js";
import { getSweepSnapshot } from "@/lib/modelLab/sweep.js";
import { enrichItemsWithCatalog, syncCatalogAll } from "@/lib/modelLab/catalog.js";

export const dynamic = "force-dynamic";

const CATALOG_MAX_AGE_MS = 24 * 3600 * 1000;

// GET /api/models/lab  → full lab payload: provider×model matrix, persisted
// test results, drift suggestions, currently-disabled models, sweep state,
// plus external model-library metadata (rating/params/price/context).
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providers = searchParams.get("providers")?.split(",").filter(Boolean) || undefined;
    const [matrix, results, drift, disabled, sweep, ratings, catalogMap, catalog] = await Promise.all([
      buildLabMatrix({ providers }),
      getModelTests(),
      getProviderDrift(),
      getDisabledModels(),
      Promise.resolve(getSweepSnapshot()),
      getModelRatings(),
      getModelInfoMap(),
      getCatalogStats(),
    ]);
    for (const group of matrix) enrichItemsWithCatalog(group.items, Object.values(catalogMap));
    const stale = !catalog.syncedAt || Date.now() - new Date(catalog.syncedAt).getTime() > CATALOG_MAX_AGE_MS;
    if (stale) syncCatalogAll().catch(() => {});
    return NextResponse.json({ providers: matrix, results, drift, disabled, sweep, ratings, catalog: { count: catalog.count, syncedAt: catalog.syncedAt, stale } });
  } catch (error) {
    console.log("[modelLab] GET /api/models/lab failed:", error);
    return NextResponse.json({ error: "Failed to load model lab", detail: error?.message || String(error) }, { status: 500 });
  }
}