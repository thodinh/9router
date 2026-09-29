import { NextResponse } from "next/server";
import { pingModelByKind, pingModelStream } from "./ping";

// POST /api/models/test - Ping a single model via internal completions or embeddings.
// body: { model, kind?, stream? } — stream:true runs the stream probe (SSE bytes
// to completion) instead of the one-shot ping; llm kinds only.
export async function POST(request) {
  try {
    const { model, kind, stream } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    const result = stream
      ? await pingModelStream(model, kind || "llm")
      : await pingModelByKind(model, kind || "llm");
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
