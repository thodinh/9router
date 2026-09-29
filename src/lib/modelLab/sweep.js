// Model Lab sweep engine — tests every provider x model in the lab matrix,
// warm-ups one model per provider first, then fans out with a small global
// concurrency cap. Results are persisted to `modelTests` and streamed to any
// connected SSE clients via subscribeSweep / broadcast.
import { pingModelByKind } from "@/app/api/models/test/ping.js";
import { upsertModelTest } from "@/lib/db/index.js";
import { buildLabMatrix } from "./plan.js";

const MAX_CONCURRENT = 6;
const PING_TIMEOUT_MS = 120_000;

const state = {
  active: false,
  jobId: null,
  startedAt: null,
  finishedAt: null,
  total: 0,
  done: 0,
  okCount: 0,
  failCount: 0,
  lastError: null,
  listeners: new Set(),
};

export function isSweepRunning() {
  return state.active;
}

export function getSweepSnapshot() {
  return {
    running: state.active,
    jobId: state.jobId,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    total: state.total,
    done: state.done,
    okCount: state.okCount,
    failCount: state.failCount,
    lastError: state.lastError,
  };
}

export function subscribeSweep(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

function broadcast(event) {
  for (const fn of state.listeners) {
    try { fn(event); } catch { /* keep going */ }
  }
}

export async function startSweep({ providers, maxModelsPerProvider } = {}) {
  if (state.active) return { running: true, jobId: state.jobId };
  state.active = true;
  state.jobId = `sweep-${Date.now()}`;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.total = 0;
  state.done = 0;
  state.okCount = 0;
  state.failCount = 0;
  state.lastError = null;
  broadcast({ kind: "start", ...getSweepSnapshot() });

  try {
    const matrix = await buildLabMatrix({ providers, maxModelsPerProvider });
    const firsts = [];
    const rests = [];
    for (const group of matrix) {
      if (!group.items.length) continue;
      const [first, ...rest] = group.items;
      firsts.push({ group, item: first });
      for (const item of rest) rests.push({ group, item });
    }
    const tasks = [...firsts, ...rests];
    state.total = tasks.length;
    broadcast({ kind: "plan", ...getSweepSnapshot() });

    if (state.total) {
      let cursor = 0;
      let inFlight = 0;
      await new Promise((resolve) => {
        const pump = () => {
          while (inFlight < MAX_CONCURRENT && cursor < tasks.length) {
            const task = tasks[cursor++];
            inFlight++;
            runTask(task).finally(() => { inFlight--; pump(); });
          }
          if (inFlight === 0 && cursor >= tasks.length) resolve();
        };
        pump();
      });
    }
  } catch (err) {
    state.lastError = err?.message || String(err);
    console.log("[modelLab] sweep failed:", err);
  } finally {
    state.active = false;
    state.finishedAt = new Date().toISOString();
    broadcast({ kind: "done", ...getSweepSnapshot() });
  }
  return { running: false, jobId: state.jobId, total: state.total };
}

async function runTask({ group, item }) {
  const t0 = Date.now();
  let result;
  try {
    result = await withTimeout(pingModelByKind(`${group.alias}/${item.id}`, item.kind), PING_TIMEOUT_MS);
  } catch (err) {
    result = { ok: false, latencyMs: null, error: (err?.message || String(err)).slice(0, 500) };
  }
  const record = {
    provider: group.provider,
    model: item.id,
    kind: item.kind,
    source: item.source,
    ok: !!result?.ok,
    latencyMs: Number.isFinite(result?.latencyMs) ? result.latencyMs : null,
    error: result?.error || null,
    testedAt: new Date().toISOString(),
  };
  try { await upsertModelTest(record); } catch { /* persist best-effort */ }
  state.done++;
  if (record.ok) state.okCount++;
  else state.failCount++;
  broadcast({
    kind: "item",
    labKey: `${record.provider}|${record.kind}|${record.model}`,
    provider: record.provider,
    model: record.model,
    ok: record.ok,
    latencyMs: record.latencyMs,
    error: record.error,
    testedAt: record.testedAt,
    done: state.done,
    total: state.total,
    running: state.active,
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}