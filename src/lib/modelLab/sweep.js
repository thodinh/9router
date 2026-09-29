// Model Lab sweep engine — tests every provider x model in the lab matrix,
// warm-ups one model per provider first, then fans out with a small global
// concurrency cap. Results are persisted to `modelTests` and streamed to any
// connected SSE clients via subscribeSweep / broadcast.
//
// mode:"alive" — the "scan alive" job: only active connections, providers
// confirmed out of credit are dropped before probing, models in combos are
// probed first, pacing is per-connection (1 in flight, waves of 8 with a 3s
// pause, exponential backoff on 429), and a passing ping is re-checked with a
// stream probe so a provider that hangs mid-stream counts as dead.
//
// mode:"free" — the "test free" job: probes exactly the price-0 candidates
// from the free report that have a connected provider, through the same
// lane-paced queue as the alive scan.
import { pingModelByKind, pingModelStream } from "@/app/api/models/test/ping.js";
import { upsertModelTest, getProviderConnections, getCombos } from "@/lib/db/index.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { buildLabMatrix } from "./plan.js";
import { getFreeReport } from "./freeHunter.js";

const MAX_CONCURRENT = 6;
const PING_TIMEOUT_MS = 120_000;

// Alive-scan pacing: per-connection lane (1 in flight), a wave of 8 probes
// then a 3s breather, and 429s back off exponentially (5s → 5min cap) on the
// offending connection only — everything else keeps moving.
const ALIVE_PER_CONNECTION = 1;
const ALIVE_WAVE = 8;
const ALIVE_WAVE_PAUSE_MS = 3_000;
const ALIVE_BACKOFF_BASE_MS = 5_000;
const ALIVE_BACKOFF_MAX_MS = 300_000;
const CREDIT_TIMEOUT_MS = 8_000;
const MODEL_LOCK_PREFIX = "modelLock_";

const state = {
  active: false,
  mode: null,
  jobId: null,
  startedAt: null,
  finishedAt: null,
  total: 0,
  done: 0,
  okCount: 0,
  failCount: 0,
  noCredit: 0,
  lastError: null,
  listeners: new Set(),
};

export function isSweepRunning() {
  return state.active;
}

export function getSweepSnapshot() {
  return {
    running: state.active,
    mode: state.mode,
    jobId: state.jobId,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    total: state.total,
    done: state.done,
    okCount: state.okCount,
    failCount: state.failCount,
    noCredit: state.noCredit,
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

export async function startSweep({ providers, maxModelsPerProvider, mode } = {}) {
  if (state.active) return { running: true, jobId: state.jobId };
  state.active = true;
  state.mode = mode === "alive" || mode === "free" ? mode : "test";
  state.jobId = `sweep-${Date.now()}`;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.total = 0;
  state.done = 0;
  state.okCount = 0;
  state.failCount = 0;
  state.noCredit = 0;
  state.lastError = null;
  broadcast({ kind: "start", ...getSweepSnapshot() });

  try {
    if (state.mode === "alive" || state.mode === "free") {
      const plan = state.mode === "free"
        ? await planFreeTasks()
        : await planAliveTasks({ providers, maxModelsPerProvider });
      state.total = plan.tasks.length;
      state.noCredit = plan.noCreditProviders.length;
      broadcast({ kind: "plan", ...getSweepSnapshot(), noCreditProviders: plan.noCreditProviders });
      if (state.total) await runAliveQueue(plan.tasks);
    } else {
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
  const fullModel = `${group.alias}/${item.id}`;
  let result;
  try {
    result = await withTimeout(pingModelByKind(fullModel, item.kind), PING_TIMEOUT_MS);
  } catch (err) {
    result = { ok: false, latencyMs: null, error: (err?.message || String(err)).slice(0, 500) };
  }
  // Alive mode: a live provider must also deliver a stream to completion —
  // a one-shot 200 hides mid-stream hangs (b.ai stalled streams for minutes).
  if (state.mode === "alive" && result?.ok && (item.kind || "llm") === "llm") {
    try {
      const s = await withTimeout(pingModelStream(fullModel, item.kind || "llm"), PING_TIMEOUT_MS);
      if (s && !s.ok && !s.skipped) result = { ...result, ok: false, error: `stream: ${s.error}` };
    } catch (err) {
      result = { ...result, ok: false, error: `stream: ${(err?.message || String(err)).slice(0, 300)}` };
    }
  }
  const record = {
    provider: group.provider,
    model: item.id,
    kind: item.kind,
    source: item.source,
    ok: !!result?.ok,
    latencyMs: Number.isFinite(result?.latencyMs) ? result?.latencyMs : null,
    status: Number.isFinite(result?.status) ? result?.status : null,
    error: result?.error || null,
    testedAt: new Date().toISOString(),
  };
  try { await upsertModelTest(record); } catch { /* persist best-effort */ }
  state.done++;
  if (record.ok) state.okCount++;
  else state.failCount++;
  broadcast({
    kind: "item",
    mode: state.mode,
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
  return record;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Alive-scan helpers ──────────────────────────────────────────────────────

// "none" = the usage API confirms the balance is empty (skip this provider),
// "ok" = balance has room, "unknown" = no usage handler / call failed — probe
// to find out rather than skip. Never throws.
async function checkConnectionCredit(connection) {
  try {
    let proxyOptions = null;
    try { proxyOptions = await resolveConnectionProxyConfig(connection); } catch { proxyOptions = null; }
    const usage = await withTimeout(getUsageForProvider(connection, proxyOptions), CREDIT_TIMEOUT_MS);
    if (!usage || typeof usage !== "object") return "unknown";
    const bal = usage?.quotas?.Balance;
    if (bal) {
      const remaining = Number(bal.remainingPercentage);
      if (Number.isFinite(remaining)) return remaining <= 0 ? "none" : "ok";
      const total = Number(bal.total);
      const used = Number(bal.used);
      if (Number.isFinite(total) && Number.isFinite(used)) return used >= total ? "none" : "ok";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

// First connection of the provider that is free to take this model: no active
// modelLock for the model itself or for the whole connection.
function pickConnection(connections, modelId) {
  const now = Date.now();
  for (const conn of connections) {
    let locked = false;
    for (const key of Object.keys(conn)) {
      if (!key.startsWith(MODEL_LOCK_PREFIX)) continue;
      const until = Number(conn[key]);
      if (!Number.isFinite(until) || until <= now) continue;
      const lockedModel = key.slice(MODEL_LOCK_PREFIX.length) || "__all";
      if (lockedModel === modelId || lockedModel === "__all") { locked = true; break; }
    }
    if (!locked) return conn;
  }
  return null;
}

// Build the alive-scan task list: active connections only, providers with a
// confirmed-empty balance dropped up front, models inside combos queued first.
export async function planAliveTasks({ providers, maxModelsPerProvider } = {}) {
  const matrix = await buildLabMatrix({ providers, maxModelsPerProvider });
  const connections = (await getProviderConnections()).filter(
    (c) => c.isActive !== false && c.testStatus !== "unavailable"
  );
  const byProvider = new Map();
  for (const conn of connections) {
    if (!byProvider.has(conn.provider)) byProvider.set(conn.provider, []);
    byProvider.get(conn.provider).push(conn);
  }

  const noCreditProviders = new Set();
  await Promise.all(
    [...byProvider.entries()].map(async ([provider, conns]) => {
      const credit = await checkConnectionCredit(conns[0]);
      if (credit === "none") noCreditProviders.add(provider);
    })
  );

  let comboModels = new Set();
  try {
    const combos = await getCombos();
    for (const combo of combos || []) {
      for (const m of combo?.models || []) comboModels.add(m);
    }
  } catch { /* combos are priority-only, not required */ }

  const prioritized = [];
  const rest = [];
  for (const group of matrix) {
    const conns = (byProvider.get(group.provider) || []).filter((c) => !noCreditProviders.has(group.provider));
    if (!conns.length) continue;
    for (const item of group.items) {
      const conn = pickConnection(conns, item.id);
      if (!conn) continue; // every connection is cooling down for this model
      const task = { group, item, connectionId: conn.id };
      if (comboModels.has(`${group.alias}/${item.id}`)) prioritized.push(task);
      else rest.push(task);
    }
  }
  return { tasks: [...prioritized, ...rest], noCreditProviders: [...noCreditProviders] };
}

// Free-scan task list: exactly the connected price-0 candidates from the free
// report (registry ∪ passthrough extras), one lane-paced task per provider
// connection. Unconnected candidates are skipped — they have no credentials
// to probe with.
async function planFreeTasks() {
  let report;
  try {
    report = await getFreeReport();
  } catch (err) {
    console.log("[modelLab] free report failed during free sweep:", err);
    return { tasks: [], noCreditProviders: [] };
  }
  const connections = (await getProviderConnections()).filter((c) => c.isActive !== false);
  const byProvider = new Map();
  for (const conn of connections) {
    if (!byProvider.has(conn.provider)) byProvider.set(conn.provider, []);
    byProvider.get(conn.provider).push(conn);
  }
  const tasks = [];
  const seen = new Set();
  for (const c of report?.candidates || []) {
    const key = `${c.provider}|${c.model}`;
    if (!c.connected || seen.has(key)) continue;
    const conns = byProvider.get(c.provider) || [];
    if (!conns.length) continue;
    const conn = pickConnection(conns, c.model);
    if (!conn) continue;
    seen.add(key);
    tasks.push({
      group: { provider: c.provider, alias: c.alias, connectionId: conn.id },
      item: { id: c.model, name: c.name || c.model, kind: "llm", source: "free" },
      connectionId: conn.id,
    });
  }
  return { tasks, noCreditProviders: [] };
}

// Lane scheduler: tasks carry a connectionId; each connection takes one probe
// at a time, pauses after each wave of 8, and backs off exponentially on 429.
// Global concurrency stays at MAX_CONCURRENT.
function runAliveQueue(tasks) {
  const lanes = new Map();
  const laneOf = (connectionId) => {
    let lane = lanes.get(connectionId);
    if (!lane) {
      lane = { running: 0, nextAt: 0, wave: 0, backoff: 0 };
      lanes.set(connectionId, lane);
    }
    return lane;
  };
  for (const task of tasks) laneOf(task.connectionId);

  return new Promise((resolve) => {
    let inFlight = 0;
    let wakeTimer = null;
    const scheduleWake = (delay) => {
      if (wakeTimer) return;
      wakeTimer = setTimeout(() => { wakeTimer = null; pump(); }, Math.max(50, delay));
      wakeTimer.unref?.();
    };

    const pump = () => {
      if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
      const now = Date.now();
      for (let i = 0; i < tasks.length && inFlight < MAX_CONCURRENT; ) {
        const lane = laneOf(tasks[i].connectionId);
        if (lane.running >= ALIVE_PER_CONNECTION || now < lane.nextAt) { i++; continue; }
        const [task] = tasks.splice(i, 1);
        lane.running++;
        inFlight++;
        runTask(task)
          .then((record) => {
            lane.running--;
            inFlight--;
            // openrouter wraps its free-tier 429 inside an HTTP 503 — back
            // off on both so a rate-limited lane cools instead of hammering.
            if (record?.status === 429 || record?.status === 503) {
              lane.backoff = Math.min(lane.backoff + 1, 6);
              lane.nextAt = Date.now() + Math.min(ALIVE_BACKOFF_MAX_MS, ALIVE_BACKOFF_BASE_MS * 2 ** (lane.backoff - 1));
            } else {
              lane.backoff = 0;
            }
            lane.wave++;
            if (lane.wave >= ALIVE_WAVE) {
              lane.wave = 0;
              lane.nextAt = Math.max(lane.nextAt, Date.now() + ALIVE_WAVE_PAUSE_MS);
            }
            pump();
          })
          .catch(() => {
            lane.running--;
            inFlight--;
            pump();
          });
        // continue scanning: same lane is now full, next iteration looks further
      }
      if (inFlight === 0 && tasks.length === 0) {
        resolve();
      } else if (inFlight === 0 && tasks.length > 0) {
        // Everything left is waiting on lane cooldowns — wake at the earliest one.
        const earliest = Math.min(...tasks.map((t) => laneOf(t.connectionId).nextAt));
        scheduleWake(earliest - Date.now());
      }
      // inFlight > 0: task completion re-pumps.
    };
    pump();
  });
}