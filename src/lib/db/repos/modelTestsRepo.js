import { getAdapter } from "../driver.js";

const COLS = "provider, model, kind, source, ok, latencyMs, error, testedAt";

function rowToTest(row) {
  return {
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    source: row.source,
    ok: row.ok === 1,
    latencyMs: row.latencyMs ?? null,
    error: row.error ?? null,
    testedAt: row.testedAt,
  };
}

export async function getModelTests({ provider } = {}) {
  const db = await getAdapter();
  const rows = provider
    ? db.all(`SELECT * FROM modelTests WHERE provider = ?`, [provider])
    : db.all(`SELECT * FROM modelTests`);
  return rows.map(rowToTest);
}

// Upsert one test result (per provider+model+kind). Latest run wins.
export async function upsertModelTest({ provider, model, kind = "llm", source = "builtin", ok, latencyMs = null, error = null, testedAt = new Date().toISOString() }) {
  const db = await getAdapter();
  db.run(
    `INSERT INTO modelTests(${COLS}) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, model, kind) DO UPDATE SET
       source = excluded.source,
       ok = excluded.ok,
       latencyMs = excluded.latencyMs,
       error = excluded.error,
       testedAt = excluded.testedAt`,
    [provider, model, kind, source, ok ? 1 : 0, latencyMs, error, testedAt]
  );
}

export async function clearModelTests(provider) {
  const db = await getAdapter();
  if (provider) db.run(`DELETE FROM modelTests WHERE provider = ?`, [provider]);
  else db.run(`DELETE FROM modelTests`);
}