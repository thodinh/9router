// Free-hunter: gathers everything the "Săn Free" tab shows, in one report.
//
//   candidates — models from the synced models.dev catalog whose price is
//                exactly 0 input / 0 output (pi/po keys), matched into the
//                local registry so every row is a model9router can actually
//                route. Badged "new" when drift just surfaced it.
//   packs      — registry providers flagged category:"freeTier" (connectable
//                gateways that give quota without a card).
//   quotas     — connected providers whose usage API reports a live balance
//                ("free within your quota"), 5-minute server cache.
//   combo      — models already approved into the `free` combo.
//
// approveFreeModel() is the one-click approve: it enables the model and folds
// it into the `free` combo (created on first approve).

import fs from "node:fs";
import { CATALOG_RAW_FILE } from "open-sse/providers/catalogOverride.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import {
  getProviderConnections,
  getProviderDrift,
  getCombos,
  getComboByName,
  createCombo,
  updateCombo,
  enableModels,
} from "@/lib/db/index.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { PROVIDER_ALIASES, baseId } from "@/lib/modelCatalog/sync.js";

export const FREE_COMBO_NAME = "free";

// Local upstream-id overrides for price lookup only. Deliberately NOT written
// into PROVIDER_ALIASES (that map feeds alias-resolution baselines) — a few
// gateways live under a different id on models.dev than in our registry.
const UPSTREAM_ALIAS = {
  ...PROVIDER_ALIASES,
  "kilo-gateway": "kilo",
};

const QUOTA_CACHE_MS = 5 * 60_000;
let quotaCache = { at: 0, rows: null };

function registryByProvider() {
  const map = new Map();
  for (const entry of REGISTRY) {
    map.set(entry.id, entry);
    if (entry.alias) map.set(entry.alias, entry);
  }
  return map;
}

function readRawCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_RAW_FILE, "utf8"));
  } catch {
    return null;
  }
}

// Returns { key, entry } of the raw catalog row matching a registry model id
// (exact, then by normalized base id — models.dev prefixes vendor/:free).
function findRawEntry(rawModels, modelId) {
  if (!rawModels) return null;
  if (rawModels[modelId]) return { key: modelId, entry: rawModels[modelId] };
  const wanted = baseId(modelId);
  for (const [key, entry] of Object.entries(rawModels)) {
    if (baseId(key) === wanted) return { key, entry };
  }
  return null;
}

function isFreeEntry(entry) {
  return !!entry && entry.pi === 0 && entry.po === 0;
}

async function gatherQuotaRows(connections) {
  const now = Date.now();
  if (quotaCache.rows && now - quotaCache.at < QUOTA_CACHE_MS) return quotaCache.rows;
  const rows = [];
  const seen = new Set();
  const byProvider = registryByProvider();
  await Promise.all(
    connections.map(async (conn) => {
      if (seen.has(conn.provider) || conn.isActive === false) return;
      seen.add(conn.provider);
      try {
        let proxyOptions = null;
        try { proxyOptions = await resolveConnectionProxyConfig(conn); } catch { proxyOptions = null; }
        const usage = await Promise.race([
          getUsageForProvider(conn, proxyOptions),
          new Promise((_, reject) => setTimeout(() => reject(new Error("usage timeout")), 8000)),
        ]);
        const bal = usage?.quotas?.Balance;
        if (!bal) return;
        const total = Number(bal.total) || 0;
        const used = Number(bal.used) || 0;
        rows.push({
          provider: conn.provider,
          alias: byProvider.get(conn.provider)?.alias || conn.provider,
          name: byProvider.get(conn.provider)?.display?.name || conn.name || conn.provider,
          connectionName: conn.name || conn.email || null,
          pct: Number.isFinite(Number(bal.remainingPercentage)) ? Number(bal.remainingPercentage) : null,
          total,
          used,
          usd: Number.isFinite(Number(bal.usdEquivalent)) ? Number(bal.usdEquivalent) : null,
          empty: total > 0 && used >= total,
        });
      } catch { /* usage not supported / timed out — just omit the row */ }
    })
  );
  rows.sort((a, b) => (b.usd ?? b.total) - (a.usd ?? a.total));
  quotaCache = { at: now, rows };
  return rows;
}

// Full report for the Free tab.
export async function getFreeReport() {
  const raw = readRawCatalog();
  const connections = (await getProviderConnections()) || [];
  const activeConnections = connections.filter((c) => c.isActive !== false);
  const connectedProviders = new Set(activeConnections.map((c) => c.provider));

  // Drift badges: provider|model ids that just appeared upstream.
  const newIds = new Set();
  try {
    for (const row of await getProviderDrift()) {
      for (const m of row?.newModels || []) newIds.add(`${row.provider}|${m}`);
    }
  } catch { /* badges are optional */ }

  // `free` combo membership for the "already added" state.
  const comboModels = new Set();
  try {
    const freeCombo = await getComboByName(FREE_COMBO_NAME);
    for (const m of freeCombo?.models || []) comboModels.add(m);
  } catch { /* combo optional */ }

  const candidates = [];
  if (raw) {
    for (const entry of REGISTRY) {
      const upstream = UPSTREAM_ALIAS[entry.id] || entry.id;
      const rawModels = raw[upstream] || raw[entry.id] || null;
      if (!rawModels) continue;
      const alias = entry.alias || entry.id;
      const displayName = entry.display?.name || alias;
      const connected = connectedProviders.has(entry.id) || connectedProviders.has(alias);
      const matchedKeys = new Set();
      for (const model of entry.models || []) {
        const hit = findRawEntry(rawModels, model.id);
        if (!hit || !isFreeEntry(hit.entry)) continue;
        matchedKeys.add(hit.key);
        const full = `${alias}/${model.id}`;
        candidates.push({
          provider: entry.id,
          alias,
          displayName,
          model: model.id,
          name: model.name || model.id,
          context: Number.isFinite(hit.entry.c) ? hit.entry.c : null,
          reasoning: hit.entry.r === true,
          connected,
          isNew: newIds.has(`${entry.id}|${model.id}`),
          inFreeCombo: comboModels.has(full),
        });
      }
      // Passthrough providers route any upstream id — surface free models the
      // static list doesn't enumerate (openrouter :free, opencode, …).
      if (entry.passthroughModels) {
        for (const [key, hit] of Object.entries(rawModels)) {
          if (matchedKeys.has(key) || !isFreeEntry(hit)) continue;
          const full = `${alias}/${key}`;
          candidates.push({
            provider: entry.id,
            alias,
            displayName,
            model: key,
            name: key,
            context: Number.isFinite(hit.c) ? hit.c : null,
            reasoning: hit.r === true,
            connected,
            isNew: newIds.has(`${entry.id}|${key}`),
            inFreeCombo: comboModels.has(full),
            passthrough: true,
          });
        }
      }
    }
  }
  candidates.sort((a, b) => (b.connected - a.connected) || (b.isNew - a.isNew) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));

  const packs = REGISTRY.filter((p) => p.category === "freeTier" && (p.models || []).length > 0).map((p) => ({
    provider: p.id,
    alias: p.alias || p.id,
    name: p.display?.name || p.alias || p.id,
    website: p.display?.website || null,
    apiKeyUrl: p.display?.notice?.apiKeyUrl || null,
    modelCount: (p.models || []).length,
    connected: connectedProviders.has(p.id) || connectedProviders.has(p.alias || p.id),
  }));

  const quotas = await gatherQuotaRows(activeConnections);

  return {
    generatedAt: new Date().toISOString(),
    catalogReady: !!raw,
    candidates,
    packs,
    quotas,
    freeCombo: [...comboModels],
  };
}

// One-click approve: enable the model in the lab + fold it into the `free`
// combo (created on first approve). Idempotent.
export async function approveFreeModel(providerId, modelId) {
  const entry = REGISTRY.find((p) => p.id === providerId || p.alias === providerId);
  if (!entry) throw new Error(`Unknown provider: ${providerId}`);
  const alias = entry.alias || entry.id;
  const known = (entry.models || []).some((m) => m.id === modelId);
  const full = `${alias}/${modelId}`;

  if (known) {
    try { await enableModels(entry.id, [modelId]); } catch { /* already enabled is fine */ }
  }

  let combo = await getComboByName(FREE_COMBO_NAME);
  let added = false;
  if (!combo) {
    combo = await createCombo({ name: FREE_COMBO_NAME, models: [full] });
    added = true;
  } else if (!(combo.models || []).includes(full)) {
    combo = await updateCombo(combo.id, { models: [...(combo.models || []), full] });
    added = true;
  }
  return { ok: true, model: full, combo: FREE_COMBO_NAME, added, inCombo: (combo?.models || []).includes(full) };
}
