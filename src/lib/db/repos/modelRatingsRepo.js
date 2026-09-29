import { getAdapter } from "../driver.js";

function rowToRating(row) {
  return {
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    rating: row.rating,
    updatedAt: row.updatedAt,
  };
}

export async function getModelRatings({ provider } = {}) {
  const db = await getAdapter();
  const rows = provider
    ? db.all(`SELECT * FROM modelRatings WHERE provider = ? ORDER BY updatedAt DESC`, [provider])
    : db.all(`SELECT * FROM modelRatings ORDER BY updatedAt DESC`);
  return rows.map(rowToRating);
}

export async function getModelRating({ provider, model, kind = "llm" }) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM modelRatings WHERE provider = ? AND model = ? AND kind = ?`, [provider, model, kind]);
  return row ? rowToRating(row) : null;
}

// rating in 1..5 sets the value; rating <= 0 clears the rating.
export async function setModelRating({ provider, model, kind = "llm", rating, updatedAt = new Date().toISOString() }) {
  const db = await getAdapter();
  if (!rating || rating <= 0) {
    db.run(`DELETE FROM modelRatings WHERE provider = ? AND model = ? AND kind = ?`, [provider, model, kind]);
    return { provider, model, kind, rating: 0 };
  }
  db.run(
    `INSERT INTO modelRatings(provider, model, kind, rating, updatedAt) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(provider, model, kind) DO UPDATE SET
       rating = excluded.rating,
       updatedAt = excluded.updatedAt`,
    [provider, model, kind, Math.min(5, Math.max(1, Math.round(rating))), updatedAt]
  );
  return { provider, model, kind, rating };
}