import { getAdapter } from "../driver.js";

const SCOPE = "modelInfo";

function rowToInfo(row) {
  return {
    model: row.model,
    name: row.name,
    creator: row.creator,
    params: row.params,
    contextLength: row.contextLength,
    pricePrompt: row.pricePrompt,
    priceCompletion: row.priceCompletion,
    rating: row.rating,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

// Bulk upsert from an external catalog sync (e.g. OpenRouter /models).
export async function saveModelInfo(rows) {
  const db = await getAdapter();
  db.transaction(() => {
    for (const r of rows) {
      db.run(
        `INSERT INTO modelInfo(model, name, creator, params, contextLength, pricePrompt, priceCompletion, rating, source, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(model) DO UPDATE SET
           name = excluded.name,
           creator = excluded.creator,
           params = excluded.params,
           contextLength = excluded.contextLength,
           pricePrompt = excluded.pricePrompt,
           priceCompletion = excluded.priceCompletion,
           rating = excluded.rating,
           source = excluded.source,
           updatedAt = excluded.updatedAt`,
        [r.model, r.name, r.creator, r.params, r.contextLength ?? null, r.pricePrompt ?? null, r.priceCompletion ?? null, r.rating ?? null, r.source || "external", r.updatedAt]
      );
    }
  });
}

export async function clearModelInfo() {
  const db = await getAdapter();
  db.run(`DELETE FROM modelInfo`);
}

export async function getModelInfoList() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM modelInfo`).map(rowToInfo);
}

export async function getModelInfoMap() {
  const list = await getModelInfoList();
  const map = {};
  for (const r of list) map[r.model] = r;
  return map;
}

export async function setCatalogSyncedAt(iso) {
  const db = await getAdapter();
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, 'syncedAt', ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, iso]
  );
}

export async function getCatalogSyncedAt() {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = 'syncedAt'`, [SCOPE]);
  return row?.value || null;
}

export async function getCatalogStats() {
  const db = await getAdapter();
  const countRow = db.get(`SELECT COUNT(*) as c FROM modelInfo`);
  return { count: countRow?.c || 0, syncedAt: await getCatalogSyncedAt() };
}