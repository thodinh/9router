import { NextResponse } from "next/server";
import { importDriftModels } from "@/lib/modelLab/drift.js";

export const dynamic = "force-dynamic";

// POST /api/models/lab/import  body: { provider, modelIds: string[] }
// Explicit user action — imports the given suggested models as customModels for
// the provider. New drift suggestions are never imported automatically.
export async function POST(request) {
  try {
    const { provider, modelIds } = await request.json();
    if (!provider || !Array.isArray(modelIds) || !modelIds.length) {
      return NextResponse.json({ error: "provider and modelIds[] required" }, { status: 400 });
    }
    const result = await importDriftModels(provider, modelIds);
    return NextResponse.json(result);
  } catch (error) {
    console.log("[modelLab] POST /api/models/lab/import failed:", error);
    return NextResponse.json({ error: "Failed to import models", detail: error?.message || String(error) }, { status: 500 });
  }
}