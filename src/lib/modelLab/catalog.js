// Model library catalog — pulls real metadata (AA Intelligence Index rating,
// context, pricing, params best-effort) from the public OpenRouter /models API
// and caches it in modelInfo. No API key required for the metadata endpoint.
import {
  saveModelInfo, setCatalogSyncedAt, clearModelInfo,
} from "@/lib/db/index.js";
import { lookupParams } from "./params.js";

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";
const PAGE_SIZE = 500;
const FETCH_TIMEOUT_MS = 25000;

let syncPromise = null;

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Params best-effort: KNOWN map → description tokens → id token. We never
// invent numbers; models with no reliable signal stay null ("—").
export function extractParams(id, name, description) {
  const fromStatic = lookupParams(id, name);
  if (fromStatic) return fromStatic;
  const d = description || "";
  let m = d.match(/\b(\d{1,4}(?:\.\d+)?)\s*billion\s*(?:params|parameters)\b/i);
  if (m) return `${Number(m[1])}B`;
  m = d.match(/(?:^|[\s,(])(\d{1,4}(?:\.\d+)?)\s*b\b(?![a-z])/i);
  if (m) return `${Number(m[1])}B`;
  m = String(id || "").toLowerCase().match(/(?:^|[-_])(\d{1,4}(?:\.\d+)?)\s*b(?=[^a-z]|$)/);
  if (m) return `${m[1]}B`;
  return null;
}

function transformModel(m) {
  const id = String(m.id || "");
  const pricing = m.pricing || {};
  return {
    model: id,
    name: m.name || id,
    creator: id.includes("/") ? id.split("/")[0] : null,
    params: extractParams(id, m.name, m.description),
    contextLength: m.context_length ?? null,
    pricePrompt: numOrNull(pricing.prompt),
    priceCompletion: numOrNull(pricing.completion),
    rating: m.benchmarks?.artificial_analysis?.intelligence_index ?? null,
    source: "openrouter",
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchOpenRouterCatalog() {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`${OPENROUTER_MODELS}?limit=${PAGE_SIZE}&offset=${offset}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data || [];
    out.push(...data);
    if (!json.links?.next || data.length < PAGE_SIZE) break;
    const url = new URL(json.links.next, OPENROUTER_MODELS);
    offset = Number(url.searchParams.get("offset")) || offset + PAGE_SIZE;
  }
  return out;
}

// Sync the whole catalog (deduped — concurrent callers share one run).
export function syncCatalogAll() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const raw = await fetchOpenRouterCatalog();
    const rows = raw.map(transformModel);
    await saveModelInfo(rows);
    const syncedAt = new Date().toISOString();
    await setCatalogSyncedAt(syncedAt);
    return { count: rows.length, syncedAt };
  })();
  syncPromise.catch(() => {}).finally(() => { syncPromise = null; });
  return syncPromise;
}

export async function clearCatalog() {
  await clearModelInfo();
}

// ---- local model id → catalog entry matching ----
function baseOf(id) {
  return String(id || "").split("/").pop().toLowerCase();
}

function normTxt(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function tokenPrefixScore(a, b) {
  const A = a.split("-");
  const B = b.split("-");
  let n = 0;
  while (n < A.length && n < B.length && A[n] === B[n]) n++;
  return n;
}

// Enrich items in-place with catalog metadata. Exact id/base match wins, then
// the longest shared token prefix (>=3 tokens), then name containment.
export function enrichItemsWithCatalog(items, catalogEntries) {
  const entries = catalogEntries.map((e) => ({
    ...e,
    base: baseOf(e.model),
    nid: normTxt(e.model),
    nname: normTxt(e.name || ""),
  }));
  for (const item of items) {
    const inbase = baseOf(item.id || "");
    const inid = normTxt(item.id || "");
    let best = entries.find((e) => e.base === inbase) || entries.find((e) => e.nid === inid) || null;
    if (!best) {
      let bestN = 2;
      for (const e of entries) {
        if (!e.base) continue;
        const score = tokenPrefixScore(inbase, e.base);
        if (score > bestN) { bestN = score; best = e; }
      }
      if (!best) {
        const iname = normTxt(item.name || item.id || "");
        best = entries.find((e) => e.nname && iname.includes(e.nname) && e.nname.length >= 6) || null;
      }
    }
    if (best) {
      item.catalogId = best.model;
      if (best.params) item.params = best.params;
      if (best.rating != null) item.rating = best.rating;
      if (best.contextLength != null) item.contextLength = best.contextLength;
      item.pricePrompt = best.pricePrompt ?? null;
      item.priceCompletion = best.priceCompletion ?? null;
    }
  }
}