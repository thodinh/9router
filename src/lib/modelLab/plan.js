import { getProviderConnections, getCustomModels } from "@/lib/db/index.js";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getInternalHeaders } from "@/app/api/models/test/ping.js";
import { lookupParams } from "./params.js";

const LIVE_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_MAX_MODELS_PER_PROVIDER = 200;

export function getProviderAlias(providerOrId) {
  return PROVIDER_ID_TO_ALIAS[providerOrId] || providerOrId;
}

export function isDynamicProvider(provider) {
  return isOpenAICompatibleProvider(provider) || isAnthropicCompatibleProvider(provider);
}

function displayNameFor(provider, connection) {
  if (isDynamicProvider(provider)) {
    return connection?.providerSpecificData?.nodeName || connection?.name || provider;
  }
  return AI_PROVIDERS[provider]?.name || getProviderAlias(provider);
}

function toItem(model, source) {
  const id = String(model.id ?? model.name ?? model.model ?? "");
  const name = String(model.name || model.id || model.model || "");
  const kind = model.kind || model.type || "llm";
  return { id, name, kind, source, params: lookupParams(id, name) };
}

export function getInternalBaseUrl() {
  return `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
}

async function fetchLiveModels(group, baseUrl) {
  const localGroup = { ...group };
  let res;
  try {
    res = await fetch(`${baseUrl}/api/providers/${localGroup.connectionId}/models`, {
      headers: await getInternalHeaders(),
      signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { models: [], error: err?.message || String(err) };
  }
  if (!res.ok) return { models: [], error: `HTTP ${res.status}` };
  const data = await res.json().catch(() => ({}));
  return { models: data.models || [], error: data.warning || null };
}

// Build the provider x model matrix:
//  - static models from the provider registry (per provider, not per connection)
//  - user custom models (customModels kv, e.g. drift "New" imports)
//  - dynamic providers (bai-style nodes, claude, others) fall back to live /models
export async function buildLabMatrix({ providers, maxModelsPerProvider = DEFAULT_MAX_MODELS_PER_PROVIDER } = {}) {
  const allConnections = await getProviderConnections();
  const customModels = await getCustomModels();
  const byProvider = new Map();
  for (const c of allConnections) {
    if (providers && !providers.includes(c.provider)) continue;
    if (!byProvider.has(c.provider)) byProvider.set(c.provider, []);
    byProvider.get(c.provider).push(c);
  }

  const baseUrl = getInternalBaseUrl();
  const out = [];
  for (const [provider, connections] of byProvider) {
    const alias = getProviderAlias(provider);
    const active = connections.filter((c) => c.isActive !== false);
    const first = active[0] || connections[0];
    const isDynamic = isDynamicProvider(provider);

    const staticModels = getProviderModels(alias) || [];
    const builtIn = staticModels.slice(0, maxModelsPerProvider).map((m) => toItem(m, "builtin"));

    const custom = customModels
      .filter((cm) => cm.providerAlias === provider)
      .map((cm) => toItem({ id: cm.id, name: cm.name, kind: cm.type }, "custom"));

    const seen = new Set(builtIn.map((i) => `${i.kind}:${i.id}`));
    const items = [...builtIn];
    for (const c of custom) {
      const key = `${c.kind}:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(c);
    }

    let liveError = null;
    if (isDynamic && !items.length && first) {
      const { models, error } = await fetchLiveModels(first, baseUrl);
      liveError = error;
      if (error) {
        out.push({ provider, alias, displayName: displayNameFor(provider, first), connectionId: first?.id || null, connectionCount: connections.length, activeCount: active.length, itemCount: 0, liveError: error, items: [] });
        continue;
      }
      for (const m of models.slice(0, maxModelsPerProvider)) {
        const item = toItem(m, "live");
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }

    out.push({
      provider,
      alias,
      displayName: displayNameFor(provider, first),
      connectionId: first?.id || null,
      connectionCount: connections.length,
      activeCount: active.length,
      itemCount: items.length,
      liveError,
      items,
    });
  }
  return out;
}