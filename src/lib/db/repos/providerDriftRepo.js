import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToDrift(row) {
  return {
    provider: row.provider,
    connectionId: row.connectionId ?? null,
    liveModels: parseJson(row.liveModels, []),
    newModels: parseJson(row.newModels, []),
    removedModels: parseJson(row.removedModels, []),
    warning: row.warning ?? null,
    fetchedAt: row.fetchedAt,
  };
}

export async function getProviderDrift({ provider } = {}) {
  const db = await getAdapter();
  const rows = provider
    ? db.all(`SELECT * FROM providerDrift WHERE provider = ?`, [provider])
    : db.all(`SELECT * FROM providerDrift`);
  return rows.map(rowToDrift);
}

export async function setProviderDrift({ provider, connectionId = null, liveModels = [], newModels = [], removedModels = [], warning = null, fetchedAt = new Date().toISOString() }) {
  const db = await getAdapter();
  db.run(
    `INSERT INTO providerDrift(provider, connectionId, liveModels, newModels, removedModels, warning, fetchedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       connectionId = excluded.connectionId,
       liveModels = excluded.liveModels,
       newModels = excluded.newModels,
       removedModels = excluded.removedModels,
       warning = excluded.warning,
       fetchedAt = excluded.fetchedAt`,
    [provider, connectionId, stringifyJson(liveModels), stringifyJson(newModels), stringifyJson(removedModels), warning, fetchedAt]
  );
}

export async function deleteProviderDrift(provider) {
  const db = await getAdapter();
  if (provider) db.run(`DELETE FROM providerDrift WHERE provider = ?`, [provider]);
  else db.run(`DELETE FROM providerDrift`);
}