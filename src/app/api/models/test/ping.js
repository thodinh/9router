import { getApiKeys } from "@/lib/localDb";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { unwrapClineEnvelope } from "open-sse/shared/clineEnvelope.js";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";

function createSilentWavFile() {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const durationMs = 250;
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: "audio/wav" });
}

export async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

export async function pingModelByKind(model, kind, baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`) {
  const headers = await getInternalHeaders();
  const start = Date.now();

  if (kind === "embedding") {
    const res = await fetch(`${baseUrl}/api/v1/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input: "test" }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.error || rawText;
      return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status };
    }
    const hasEmbedding = Array.isArray(parsed?.data) && parsed.data.length > 0 && Array.isArray(parsed.data[0]?.embedding);
    if (!hasEmbedding) {
      return { ok: false, latencyMs, status: res.status, error: "Provider returned no embedding data" };
    }
    return { ok: true, latencyMs, error: null, status: res.status };
  }

  if (kind === "image") {
    const res = await fetch(`${baseUrl}/api/v1/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, prompt: "test" }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status };
    }

    const hasImages = Array.isArray(parsed?.data) && parsed.data.length > 0;
    if (!hasImages) {
      return { ok: false, latencyMs, status: res.status, error: "Provider returned no image data for this model" };
    }
    return { ok: true, latencyMs, error: null, status: res.status };
  }

  if (kind === "stt") {
    const form = new FormData();
    const sampleAudio = createSilentWavFile();
    form.append("file", sampleAudio, "test.wav");
    form.append("model", model);

    const res = await fetch(`${baseUrl}/api/v1/audio/transcriptions`, {
      method: "POST",
      headers: Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== "content-type")),
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status };
    }

    const text = typeof parsed?.text === "string" ? parsed.text : "";
    if (!text.trim()) {
      return { ok: false, latencyMs, status: res.status, error: "Provider returned no transcription text for this model" };
    }
    return { ok: true, latencyMs, error: null, status: res.status };
  }

  if (kind === "systemone") {
    const res = await fetch(`${baseUrl}/api/v1/systemone`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        state: "Customer: I was charged twice for my order this morning.",
        questions: {
          probe: { type: "noul", instructions: "Is the customer reporting a billing problem?" },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`, status: res.status };
    }

    const hasAnswers = parsed?.answers && typeof parsed.answers === "object" && Object.keys(parsed.answers).length > 0;
    if (!hasAnswers) {
      return { ok: false, latencyMs, status: res.status, error: "Provider returned no answers for this model" };
    }
    return { ok: true, latencyMs, error: null, status: res.status };
  }

  const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      // 1024 tokens: reasoning models (ClinePass/kimi-k3, deepseek-v4-pro, etc.) spend
      // their budget on chain-of-thought before emitting an answer. A tiny probe like
      // max_tokens:16 starves the answer and yields a false "no choices" failure.
      // See issue #3010.
      max_tokens: 1024,
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const latencyMs = Date.now() - start;

  const rawText = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

  // Unwrap before the choices checks below. No-op for providers that do not
  // opt in via transport.quirks.clineEnvelope.
  const providerId = resolveProviderId(String(model).split("/")[0]);
  parsed = unwrapClineEnvelope(parsed, providerId);

  if (!res.ok) {
    const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
    return { ok: false, latencyMs, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 500)}` : ""}`, status: res.status };
  }

  const providerStatus = parsed?.status;
  const providerMsg = parsed?.msg || parsed?.message;
  const hasProviderErrorStatus = providerStatus !== undefined
    && providerStatus !== null
    && String(providerStatus) !== "200"
    && String(providerStatus) !== "0";
  if (hasProviderErrorStatus && providerMsg) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
    };
  }

  if (parsed?.error) {
    const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: String(providerError).slice(0, 240),
    };
  }

  const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;

  // Soft-pass (issue #3010): a reasoning model may burn its whole budget on
  // chain-of-thought and return finish_reason:"length" with empty content but
  // non-empty reasoning/thinking. That's a successful connection, not a failure.
  const firstChoice = parsed?.choices?.[0] || {};
  const hasReasoning =
    firstChoice.message?.reasoning ||
    firstChoice.message?.reasoning_content ||
    firstChoice.message?.thinking ||
    firstChoice.message?.thinking_content;
  const contentEmpty = !String(firstChoice.message?.content || "").trim();
  if (hasChoices && firstChoice.finish_reason === "length" && contentEmpty && hasReasoning) {
    return { ok: true, latencyMs, error: null, status: res.status, note: "reasoning-only response (length-limited)" };
  }

  if (!hasChoices) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: "Provider returned no completion choices for this model",
    };
  }

  return { ok: true, latencyMs, error: null, status: res.status };
}

const STREAM_STALL_MS = 20_000;
const STREAM_TOTAL_TIMEOUT_MS = 30_000;

// Stream probe: same chat completion as pingModelByKind but stream:true, read
// to completion. A one-shot ping can pass on a provider that then stalls
// mid-stream (b.ai lesson: test 200 while ~10% of streams hang for minutes),
// so "alive" really means: SSE bytes start AND the stream finishes.
// Only meaningful for chat kinds — embeddings/rerank have no stream to read.
export async function pingModelStream(
  model,
  kind = "llm",
  baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`
) {
  if (kind && kind !== "llm") return { ok: true, skipped: true, latencyMs: null, error: null };
  const headers = await getInternalHeaders();
  const start = Date.now();

  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        // Small budget: this probe only proves bytes flow to completion, not
        // answer quality. Reasoning models spend it on thinking — still fine,
        // thinking tokens stream too.
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(STREAM_TOTAL_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err?.name === "TimeoutError" ? `stream-timeout after ${STREAM_TOTAL_TIMEOUT_MS / 1000}s` : `stream fetch failed: ${err?.message || err}`;
    return { ok: false, latencyMs: Date.now() - start, error: msg };
  }

  const headerMs = Date.now() - start;
  if (!res.ok) {
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}
    const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
    return { ok: false, latencyMs: headerMs, status: res.status, error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 300)}` : ""}` };
  }
  if (!res.body) return { ok: false, latencyMs: headerMs, status: res.status, error: "stream response has no body" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let ttfbMs = null;
  let lastChunkAt = Date.now();
  let chunks = 0;
  let sawDone = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const now = Date.now();
      if (ttfbMs === null) ttfbMs = now - start;
      chunks++;
      // Guard against a slow drip: bytes must keep arriving within the stall
      // window and the whole stream must finish inside the total timeout.
      if (now - lastChunkAt > STREAM_STALL_MS || now - start > STREAM_TOTAL_TIMEOUT_MS) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return { ok: false, latencyMs: now - start, ttfbMs, error: `stream-stall: no bytes for ${STREAM_STALL_MS / 1000}s`, status: res.status };
      }
      lastChunkAt = now;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes("data: [DONE]") || buf.includes("data:[DONE]")) { sawDone = true; break; }
      // Guard against a slow drip that outlives the total timeout margin.
      if (now - start > STREAM_TOTAL_TIMEOUT_MS || now - lastChunkAt > STREAM_STALL_MS) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return { ok: false, latencyMs: now - start, ttfbMs, error: `stream-stall: no bytes for ${STREAM_STALL_MS / 1000}s`, status: res.status };
      }
    }
  } catch (err) {
    const msg = err?.name === "TimeoutError" || err?.name === "AbortError"
      ? `stream-stall: aborted after ${STREAM_TOTAL_TIMEOUT_MS / 1000}s`
      : `stream read failed: ${err?.message || err}`;
    return { ok: false, latencyMs: Date.now() - start, ttfbMs, error: msg, status: res.status };
  }

  const latencyMs = Date.now() - start;
  if (chunks === 0) return { ok: false, latencyMs, error: "stream produced no bytes", status: res.status };
  // Some providers close without [DONE]; bytes-to-completion is enough here.
  return { ok: true, latencyMs, ttfbMs, chunks, sawDone, error: null, status: res.status };
}
