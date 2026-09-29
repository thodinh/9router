// Model Lab drift — diffs a provider's live /models responses against what the
// router is configured with (static registry models + user customModels).
// New models are STORED as suggestions only (providerDrift.newModels); they are
// never auto-imported. importDriftModels() applies an explicit user decision.
import { getProviderConnections, getCustomModels, addCustomModel, setProviderDrift, getProviderDrift } from "@/lib/db/index.js";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { getInternalBaseUrl } from "./plan.js";
import { getInternalHeaders } from "@/app/api/models/test/ping.js";

const FETCH_TIMEOUT_MS = 8000;

async function persistDriftError(provider, connectionId, error) {
  try {
    const prev = (await getProviderDrift({ provider }))[0];
    await setProviderDrift({
      provider,
      connectionId: prev?.connectionId || connectionId,
      liveModels: prev?.liveModels || [],
      newModels: prev?.newModels || [],
      removedModels: prev?.removedModels || [],
      warning: `Sync failed (${error})`,
      fetchedAt: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

export async function computeConfiguredIds(provider, customModels) {
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const staticIds = (getProviderModels(alias) || []).map((m) => String(m.id));
  const customIds = customModels
    .filter((cm) => cm.providerAlias === provider)
    .map((cm) => String(cm.id));
  return new Set([...staticIds, ...customIds]);
}

export async function syncAllProvidersDrift() {
  const connections = await getProviderConnections();
  const providers = [...new Set(connections.map((c) => c.provider))];
  const results = [];
  for (const provider of providers) {
    try {
      results.push(await syncProviderDrift(provider));
    } catch (err) {
      results.push({ provider, error: err?.message || String(err) });
    }
  }
  return results;
}

export async function syncProviderDrift(provider) {
  const connections = await getProviderConnections({ provider });
  const connection = connections.find((c) => c.isActive !== false) || connections[0];
  if (!connection) return { provider, error: "No connection for provider" };

  const baseUrl = getInternalBaseUrl();
  let payload;
  try {
    const res = await fetch(`${baseUrl}/api/providers/${connection.id}/models`, {
      headers: await getInternalHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await persistDriftError(provider, connection.id, `HTTP ${res.status}`);
      return { provider, error: `HTTP ${res.status}` };
    }
    payload = await res.json();
  } catch (err) {
    const msg = err?.message || String(err);
    await persistDriftError(provider, connection.id, msg);
    return { provider, error: msg };
  }

  const live = (payload.models || [])
    .map((m) => ({ id: String(m.id ?? m.name ?? m.model ?? ""), name: String(m.name || m.id || m.model || "") }))
    .filter((m) => m.id);
  const liveIds = new Set(live.map((m) => m.id));

  const customModels = await getCustomModels();
  const configured = await computeConfiguredIds(provider, customModels);

  const newModels = live.filter((m) => !configured.has(m.id));
  const removedModels = [...configured].filter((id) => !liveIds.has(id)).map((id) => ({ id, name: id }));

  const record = {
    provider,
    connectionId: connection.id,
    liveModels: live,
    newModels,
    removedModels,
    warning: payload.warning || null,
    fetchedAt: new Date().toISOString(),
  };
  await setProviderDrift(record);
  return {
    provider,
    connectionId: connection.id,
    liveCount: live.length,
    newCount: newModels.length,
    removedCount: removedModels.length,
    warning: payload.warning || null,
  };
}

// Explicit user action: import suggested models as customModels for this provider.
export async function importDriftModels(provider, modelIds) {
  const customModels = await getCustomModels();
  const configured = await computeConfiguredIds(provider, customModels);
  const added = [];
  for (const id of modelIds) {
    if (configured.has(id)) continue;
    const ok = await addCustomModel({ providerAlias: provider, id, type: "llm", name: id });
    if (ok) added.push(id);
  }
  if (added.length) {
    try { await syncProviderDrift(provider); } catch { /* non-fatal */ }
  }
  return { provider, added, skipped: modelIds.length - added.length };
}

export async function getDriftSummary() {
  return (await getProviderDrift()).map((d) => ({
    provider: d.provider,
    connectionId: d.connectionId,
    liveCount: d.liveModels.length,
    newCount: d.newModels.length,
    removedCount: d.removedModels.length,
    newModels: d.newModels,
    removedModels: d.removedModels,
    warning: d.warning,
    fetchedAt: d.fetchedAt,
  }));
}