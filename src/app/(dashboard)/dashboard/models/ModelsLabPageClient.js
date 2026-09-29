"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Badge, Modal } from "@/shared/components";
import { getRelativeTime } from "@/shared/utils";
import { lookupParams } from "@/lib/modelLab/params.js";

const MATRIX_PAGE = 40;
const FLAT_PAGE = 100;
const DRIFT_PAGE = 15;
const VIEW_KEY = "9r-models-view";
const HIDE_DISABLED_KEY = "9r-models-hide-disabled";

const SORT_OPTIONS = [
  { value: "", label: "Order" },
  { value: "rating", label: "Rating ↓" },
  { value: "params", label: "Params ↓" },
  { value: "price", label: "Price ↑" },
  { value: "context", label: "Context ↓" },
];

function modelKey(provider, item) {
  return `${provider}|${item.kind}|${item.id}`;
}

function paramNum(value) {
  if (!value) return 0;
  const s = String(value);
  if (s.includes("×")) {
    const [a, b] = s.split("×").map((x) => parseFloat(x) || 0);
    return a * b;
  }
  const m = s.match(/([\d.]+)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return /t/i.test(s) ? n * 1000 : n;
}

function blendedPrice(item) {
  const p = item.pricePrompt;
  const c = item.priceCompletion;
  if (p == null && c == null) return Infinity;
  return (3 * (p ?? c ?? 0) + (c ?? p ?? 0)) / 4;
}

function StatusBadge({ result }) {
  const meta = !result ? { variant: "default", icon: "help", label: "Untested" } : result.ok ? { variant: "success", icon: "check_circle", label: "OK" } : { variant: "error", icon: "cancel", label: "Failed" };
  return (
    <Badge variant={meta.variant} icon={meta.icon} size="sm">
      {meta.label}
    </Badge>
  );
}

function Chevron({ open }) {
  return <span className={`material-symbols-outlined text-base transition-transform ${open ? "rotate-180" : ""}`}>expand_more</span>;
}

const SOURCE_VARIANT = { builtin: "default", custom: "primary", live: "info" };

// External quality rating — Artificial Analysis Intelligence Index (0-100)
// mapped to 1-5 stars; the raw index is shown next to the stars.
function RatingStars({ rating }) {
  if (rating == null || rating <= 0) return <span className="text-xs text-text-muted/50">—</span>;
  const stars = Math.max(1, Math.min(5, Math.round(rating / 20)));
  return (
    <div className="flex items-center gap-1.5" title={`AA Intelligence Index ${rating}/100`}>
      <div className="flex gap-0.5 text-brand-500">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className="material-symbols-outlined text-base">{n <= stars ? "star" : "star_outline"}</span>
        ))}
      </div>
      <span className="text-xs text-text-muted tabular-nums">{rating}</span>
    </div>
  );
}

// Aligned table of configured/imported models — fixed columns so status,
// latency and long error messages never break the row layout.
// rows: [{ group, item }] — flat mode passes showProvider to add the column.
function ConfiguredTable({ rows, showProvider = false, emptyMessage = "No models to show.", resultsMap, liveResults, testingKey, copied, disabled, onCopy, onTest, onToggleDisabled }) {
  const colSpan = 7 + (showProvider ? 1 : 0);
  return (
    <div className="max-h-[55vh] overflow-y-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-surface-2 z-10">
          <tr className="text-left text-xs text-text-muted">
            {showProvider && <th className="px-3 py-2 font-medium w-40">Provider</th>}
            <th className="px-3 py-2 font-medium w-[24%]">Model</th>
            <th className="px-3 py-2 font-medium w-20">Params</th>
            <th className="px-3 py-2 font-medium w-36">Rating</th>
            <th className="px-3 py-2 font-medium w-24">Status</th>
            <th className="px-3 py-2 font-medium w-20 text-right">Time</th>
            <th className="px-3 py-2 font-medium">Detail</th>
            <th className="px-3 py-2 font-medium w-32 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-3 py-6 text-center text-xs text-text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map(({ group, item }) => {
            const key = modelKey(group.provider, item);
            const result = liveResults[key] || resultsMap[key];
            const isDisabled = (disabled[group.provider] || []).includes(item.id);
            const price = item.pricePrompt != null ? blendedPrice(item) : null;
            return (
              <tr key={key} className="hover:bg-surface-2/40">
                {showProvider && (
                  <td className="px-3 py-2" title={group.provider}>
                    <span className="block max-w-[140px] truncate text-xs text-text-muted">{group.displayName}</span>
                  </td>
                )}
                <td className="px-3 py-2 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className={`font-mono text-[13px] truncate max-w-[200px] ${isDisabled ? "line-through text-text-muted" : ""}`} title={item.id}>
                      {item.id}
                    </code>
                    <Badge variant={SOURCE_VARIANT[item.source] || "default"} size="sm">{item.source}</Badge>
                    {isDisabled && <Badge variant="default" size="sm">disabled</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-text-muted tabular-nums whitespace-nowrap" title={item.params ? `≈ ${item.params} parameters` : "Parameters unknown"}>
                  {item.params || <span className="text-text-muted/50">—</span>}
                </td>
                <td className="px-3 py-2">
                  <RatingStars rating={item.rating} />
                </td>
                <td className="px-3 py-2"><StatusBadge result={result} /></td>
                <td className="px-3 py-2 text-right text-xs text-text-muted tabular-nums whitespace-nowrap">
                  {result?.latencyMs != null ? `${result.latencyMs}ms` : "—"}
                </td>
                <td className="px-3 py-2 min-w-0">
                  <div className="flex flex-col gap-0.5">
                    {result?.error ? (
                      <span className="block max-w-[280px] truncate text-xs text-text-muted" title={result.error}>{result.error}</span>
                    ) : result?.testedAt ? (
                      <span className="block max-w-[280px] truncate text-xs text-text-muted">{getRelativeTime(result.testedAt)}</span>
                    ) : (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                    {price != null && (
                      <span className="block max-w-[280px] truncate text-[11px] text-text-muted/50">${price.toFixed(4)}/1M · {item.contextLength ? `${Math.round(item.contextLength / 1000)}k ctx` : ""}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onCopy(`${group.alias}/${item.id}`, `copy-${key}`)} className="p-1.5 hover:bg-surface-2 rounded text-text-muted hover:text-primary transition-colors" title="Copy full model name">
                      <span className="material-symbols-outlined text-base">{copied === `copy-${key}` ? "check" : "content_copy"}</span>
                    </button>
                    <button onClick={() => onTest(group, item)} disabled={testingKey === key} className="p-1.5 hover:bg-surface-2 rounded text-text-muted hover:text-primary transition-colors" title="Test this model">
                      <span className={`material-symbols-outlined text-base ${testingKey === key ? "animate-spin" : ""}`}>{testingKey === key ? "progress_activity" : "science"}</span>
                    </button>
                    <button onClick={() => onToggleDisabled(group, item)} className={`p-1.5 rounded transition-colors ${isDisabled ? "text-green-500 hover:bg-green-500/10" : "text-text-muted hover:bg-surface-2 hover:text-primary"}`} title={isDisabled ? "Enable model" : "Disable model"}>
                      <span className="material-symbols-outlined text-base">{isDisabled ? "toggle_on" : "toggle_off"}</span>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Modal for the (potentially huge) drift "new" list — search + select + import.
function DriftModal({ group, drift, selectedNew, onImport, onToggleSelectNew, onToggleSelectAllNew, onClose }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(DRIFT_PAGE);

  const allNew = useMemo(() => (drift?.newModels || []), [drift]);
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => allNew.filter((m) => !q || `${m.id} ${m.name}`.toLowerCase().includes(q)), [allNew, q]);
  const visible = filtered.slice(0, rows);

  const newChecked = selectedNew[group.provider] || [];
  const allNewIds = allNew.map((m) => m.id);
  const allSelected = newChecked.length > 0 && allNewIds.length > 0 && allNewIds.every((id) => newChecked.includes(id));

  return (
    <Modal isOpen onClose={onClose} title={`${group.displayName} · New models on /models`} size="full">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setRows(DRIFT_PAGE); }}
            placeholder="Search new models…"
            autoFocus
            className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onToggleSelectAllNew(group.provider, allNewIds)}
              disabled={!allNewIds.length}
              className="text-xs text-text-muted hover:text-primary disabled:opacity-40"
            >
              {allSelected ? "Clear all" : `Select all ${allNewIds.length}`}
            </button>
            <Button size="sm" icon="download" onClick={() => onImport(group.provider, newChecked)} disabled={!newChecked.length}>
              Import selected ({newChecked.length})
            </Button>
          </div>
        </div>

        <p className="text-xs text-text-muted">
          {drift?.removedModels?.length ? `${drift.removedModels.length} removed from /models (no longer listed). ` : ""}
          {drift?.warning ? `Last sync failed: ${drift.warning}` : ""}
        </p>

        <div className="max-h-[55vh] overflow-y-auto border border-border rounded-lg">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-surface-2 z-10">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-3 py-2 font-medium w-10">&nbsp;</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium w-20">Params</th>
                <th className="px-3 py-2 font-medium w-24 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-text-muted">
                    {allNew.length === 0 ? "No new models." : "No new models match the search."}
                  </td>
                </tr>
              )}
              {visible.map((m) => (
                <tr key={m.id} className="hover:bg-surface-2/40">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={newChecked.includes(m.id)} onChange={() => onToggleSelectNew(group.provider, m.id)} className="accent-brand-500" />
                  </td>
                  <td className="px-3 py-2 font-mono text-[13px] truncate max-w-[320px]" title={m.id}>{m.id}</td>
                  <td className="px-3 py-2 text-xs text-text-muted truncate max-w-[240px]" title={m.name}>{m.name}</td>
                  <td className="px-3 py-2 text-xs text-text-muted tabular-nums whitespace-nowrap">{lookupParams(m.id, m.name) || "—"}</td>
                  <td className="px-3 py-2 text-right"><Badge variant="warning" size="sm">new</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length > visible.length && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">Showing {visible.length} of {filtered.length}</span>
            <Button size="sm" variant="secondary" icon="expand_more" onClick={() => setRows((r) => r + DRIFT_PAGE)}>Load more</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function ModelsLabPageClient() {
  const [lab, setLab] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("flat");
  const [hideDisabled, setHideDisabled] = useState(false);
  const [sortFlat, setSortFlat] = useState("");
  const [flatLimit, setFlatLimit] = useState(FLAT_PAGE);
  const [expanded, setExpanded] = useState(() => new Set());
  const [visibleCount, setVisibleCount] = useState({});
  const [sortSel, setSortSel] = useState({});
  const [sweep, setSweep] = useState({ running: false, total: 0, done: 0, okCount: 0, failCount: 0 });
  const [liveResults, setLiveResults] = useState({});
  const [testingKey, setTestingKey] = useState(null);
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState("");
  const [selectedNew, setSelectedNew] = useState({});
  const [driftProvider, setDriftProvider] = useState(null);
  const readerRef = useRef(null);

  const loadLab = useCallback(async () => {
    try {
      const res = await fetch("/api/models/lab");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setLab(data);
      setSweep((prev) => ({ ...prev, ...data.sweep }));
      return data;
    } catch (err) {
      setError(err.message || String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const data = await loadLab();
      try {
        const v = globalThis.localStorage?.getItem(VIEW_KEY);
        if (v === "flat" || v === "grouped") setView(v);
        if (globalThis.localStorage?.getItem(HIDE_DISABLED_KEY) === "1") setHideDisabled(true);
      } catch { /* prefs are best-effort */ }
      if (!data) return;
      const auto = new Set(data.providers.filter((p) => (p.itemCount || 0) <= 12).map((p) => p.provider));
      setExpanded(auto);
    };
    init();
    return () => readerRef.current?.cancel?.();
  }, [loadLab]);

  const changeView = useCallback((v) => {
    setView(v);
    setFlatLimit(FLAT_PAGE);
    try { globalThis.localStorage?.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }, []);

  const toggleHideDisabled = useCallback(() => {
    setHideDisabled((prev) => {
      const next = !prev;
      try { globalThis.localStorage?.setItem(HIDE_DISABLED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
    setFlatLimit(FLAT_PAGE);
  }, []);

  const onSearch = (value) => {
    setSearch(value);
    setExpanded(() => new Set());
    setVisibleCount(() => ({}));
    setFlatLimit(FLAT_PAGE);
  };

  const applySweepEvent = useCallback((evt) => {
    if (!evt || typeof evt !== "object") return;
    if (evt.kind === "item" && evt.labKey) {
      setLiveResults((prev) => ({ ...prev, [evt.labKey]: evt }));
    }
    setSweep((prev) => ({
      running: evt.running ?? prev.running,
      jobId: evt.jobId ?? prev.jobId,
      total: evt.total ?? prev.total,
      done: evt.done ?? prev.done,
      okCount: evt.okCount ?? prev.okCount,
      failCount: evt.failCount ?? prev.failCount,
      startedAt: evt.startedAt ?? prev.startedAt,
      finishedAt: evt.finishedAt ?? prev.finishedAt,
      lastError: evt.lastError ?? prev.lastError,
    }));
    if (evt.kind === "done") {
      setTimeout(() => loadLab(), 200);
    }
  }, [loadLab]);

  const openStream = useCallback(() => {
    fetch("/api/models/lab/test/stream").then(async (res) => {
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop();
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let evt;
            try { evt = JSON.parse(line.slice(6)); } catch { continue; }
            applySweepEvent(evt);
          }
        }
      } catch { /* stream closed */ }
    });
  }, [applySweepEvent]);

  const startTestAll = useCallback(async () => {
    setError("");
    await fetch("/api/models/lab/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    openStream();
  }, [openStream]);

  const startTestProvider = useCallback(async (provider) => {
    setError("");
    await fetch("/api/models/lab/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providers: [provider] }) });
    openStream();
  }, [openStream]);

  const syncDrift = useCallback(async (provider) => {
    setBusy(provider ? `drift:${provider}` : "drift");
    try {
      await fetch("/api/models/lab/drift", { method: "POST", headers: { "Content-Type": "application/json" }, body: provider ? JSON.stringify({ provider }) : "{}" });
      await loadLab();
    } finally {
      setBusy("");
    }
  }, [loadLab]);

  const syncLibrary = useCallback(async () => {
    setBusy("library");
    try {
      const res = await fetch("/api/models/library/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Sync failed");
      await loadLab();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy("");
    }
  }, [loadLab]);

  const toggleExpand = useCallback((provider) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
    setVisibleCount((prev) => ({ ...prev, [provider]: MATRIX_PAGE }));
  }, []);

  const loadMore = (provider) => {
    setVisibleCount((prev) => ({ ...prev, [provider]: (prev[provider] || 0) + MATRIX_PAGE }));
  };

  const testOne = useCallback(async (group, item) => {
    const key = modelKey(group.provider, item);
    if (testingKey) return;
    setTestingKey(key);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${group.alias}/${item.id}`, kind: item.kind }),
      });
      const data = await res.json();
      setLiveResults((prev) => ({
        ...prev,
        [key]: { provider: group.provider, labKey: key, model: item.id, kind: item.kind, ok: !!data.ok, latencyMs: data.latencyMs ?? null, error: data.error ?? null, testedAt: new Date().toISOString() },
      }));
    } catch {
      setLiveResults((prev) => ({
        ...prev,
        [key]: { provider: group.provider, labKey: key, model: item.id, kind: item.kind, ok: false, latencyMs: null, error: "Network error", testedAt: new Date().toISOString() },
      }));
    } finally {
      setTestingKey(null);
    }
  }, [testingKey]);

  const toggleDisabled = useCallback(async (group, item) => {
    const currently = (lab.disabled?.[group.provider] || []).includes(item.id);
    if (currently) {
      await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(group.provider)}&id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    } else {
      await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: group.provider, ids: [item.id] }),
      });
    }
    loadLab();
  }, [lab, loadLab]);

  const importSelected = useCallback(async (provider, ids) => {
    if (!ids.length) return;
    await fetch("/api/models/lab/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, modelIds: ids }),
    });
    setSelectedNew((prev) => ({ ...prev, [provider]: [] }));
    loadLab();
  }, [loadLab]);

  const toggleSelectNew = useCallback((provider, id) => {
    setSelectedNew((prev) => {
      const cur = prev[provider] || [];
      return { ...prev, [provider]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  }, []);

  const toggleSelectAllNew = useCallback((provider, ids) => {
    setSelectedNew((prev) => {
      const cur = prev[provider] || [];
      const allPicked = ids.every((id) => cur.includes(id));
      const nextSet = new Set(allPicked ? cur.filter((x) => !ids.includes(x)) : [...cur, ...ids]);
      return { ...prev, [provider]: [...nextSet] };
    });
  }, []);

  const copyText = useCallback(async (text, id) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setCopied(id);
    setTimeout(() => setCopied(""), 1200);
  }, []);

  const resultsMap = useMemo(() => {
    const map = {};
    for (const r of (lab?.results || [])) map[modelKey(r.provider, r)] = r;
    return map;
  }, [lab]);

  const driftByProvider = useMemo(() => {
    const map = {};
    for (const d of (lab?.drift || [])) map[d.provider] = d;
    return map;
  }, [lab]);

  const progress = sweep.total > 0 ? Math.round((sweep.done / sweep.total) * 100) : 0;

  const countsFor = (group) => {
    const c = { ok: 0, fail: 0, untested: 0 };
    const dis = lab.disabled?.[group.provider] || [];
    for (const item of group.items) {
      if (hideDisabled && dis.includes(item.id)) continue;
      const r = liveResults[modelKey(group.provider, item)] || resultsMap[modelKey(group.provider, item)];
      if (!r) c.untested++;
      else if (r.ok) c.ok++;
      else c.fail++;
    }
    return c;
  };

  const driftGroup = driftProvider ? lab.providers.find((p) => p.provider === driftProvider) : null;

  if (loading) {
    return <div className="p-6 text-sm text-text-muted">Loading model lab…</div>;
  }
  if (!lab) {
    return <div className="p-6 text-sm text-red-500">{error || "Failed to load"}</div>;
  }

  const q = search.trim().toLowerCase();
  const visibleGroups = lab.providers.filter((g) => !q || `${g.displayName} ${g.provider} ${g.alias}`.toLowerCase().includes(q));

  const sortComparator = (key) => {
    switch (key) {
      case "rating": return (a, b) => (b.rating ?? -1) - (a.rating ?? -1);
      case "params": return (a, b) => paramNum(b.params) - paramNum(a.params);
      case "price": return (a, b) => blendedPrice(a) - blendedPrice(b);
      case "context": return (a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0);
      default: return null;
    }
  };

  const disabledMap = lab.disabled || {};
  const disabledTotal = Object.values(disabledMap).reduce((n, a) => n + (a?.length || 0), 0);
  const isDis = (provider, id) => (disabledMap[provider] || []).includes(id);

  // Flat (default) view — every model in one list; search matches model id too.
  const flatRows = [];
  for (const g of lab.providers) {
    const providerMatch = !q || `${g.displayName} ${g.provider} ${g.alias}`.toLowerCase().includes(q);
    for (const item of g.items) {
      if (hideDisabled && isDis(g.provider, item.id)) continue;
      if (q && !providerMatch && !item.id.toLowerCase().includes(q)) continue;
      flatRows.push({ group: g, item });
    }
  }
  const cmpFlat = sortComparator(sortFlat);
  const flatSorted = cmpFlat ? [...flatRows].sort(cmpFlat) : flatRows;
  const flatVisible = flatSorted.slice(0, flatLimit);
  const driftPending = (lab.drift || []).filter((d) => (d.newModels?.length || 0) > 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Model Lab</h1>
          <p className="text-sm text-text-muted mt-1">All models in one list or grouped by provider — test vs live drift suggestions.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" icon="sync" onClick={() => syncDrift()} loading={busy === "drift"} disabled={sweep.running}>
            {sweep.running ? "" : "Sync All"}
          </Button>
          <Button icon="science" onClick={startTestAll} loading={sweep.running} disabled={sweep.running}>
            {sweep.running ? "Testing…" : "Test All"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-4 py-2 flex-wrap">
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-text">Model Library</span>
          {` · ${lab.catalog?.count ?? 0} models`}
          {lab.catalog?.syncedAt ? ` · synced ${getRelativeTime(lab.catalog.syncedAt)}` : " · not synced yet"}
          {lab.catalog?.stale && <span className="text-yellow-600 dark:text-yellow-400"> · outdated</span>}
          {lab.catalog?.count === 0 && " — sync once to fill ratings & params from OpenRouter/Artificial Analysis"}
        </p>
        <Button size="sm" variant="secondary" icon="refresh" onClick={syncLibrary} loading={busy === "library"}>Sync</Button>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

      {sweep.running && (
        <div className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">Running tests</span>
            <span className="text-text-muted">{sweep.done}/{sweep.total} · {sweep.okCount} ok · {sweep.failCount} failed</span>
          </div>
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Filter models or providers…"
          className="flex-1 min-w-[220px] max-w-md px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
        />
        {view === "flat" && (
          <select
            value={sortFlat}
            onChange={(e) => { setSortFlat(e.target.value); setFlatLimit(FLAT_PAGE); }}
            className="px-2 py-2 text-xs text-text-muted bg-background border border-border rounded-lg focus:outline-none focus:border-primary"
            title="Sort all models"
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button
          onClick={toggleHideDisabled}
          className="flex items-center gap-1 px-2.5 py-2 text-xs border border-border rounded-lg text-text-muted hover:text-primary hover:bg-surface-2 transition-colors"
          title={hideDisabled ? "Disabled models are hidden — click to show them" : `Disabled models are visible — click to hide them${disabledTotal ? ` (${disabledTotal})` : ""}`}
        >
          <span className={`material-symbols-outlined text-base ${hideDisabled ? "text-brand-500" : ""}`}>{hideDisabled ? "toggle_on" : "toggle_off"}</span>
          {hideDisabled ? "Show disabled" : `Hide disabled${disabledTotal ? ` (${disabledTotal})` : ""}`}
        </button>
        <div className="flex items-center border border-border rounded-lg overflow-hidden text-xs">
          <button
            onClick={() => changeView("flat")}
            className={`px-3 py-2 transition-colors ${view === "flat" ? "bg-brand-500 text-white" : "text-text-muted hover:bg-surface-2 hover:text-primary"}`}
            title="Flat list of all models"
          >All models</button>
          <button
            onClick={() => changeView("grouped")}
            className={`px-3 py-2 transition-colors ${view === "grouped" ? "bg-brand-500 text-white" : "text-text-muted hover:bg-surface-2 hover:text-primary"}`}
            title="Group models by provider"
          >By provider</button>
        </div>
      </div>

      {view === "flat" ? (
        <div className="border border-border rounded-xl overflow-hidden">
          {driftPending.length > 0 && (
            <div className="px-4 py-2 bg-yellow-500/5 border-b border-border flex items-center gap-2 flex-wrap">
              <span className="text-xs text-text-muted">New models detected:</span>
              {driftPending.map((d) => {
                const g = lab.providers.find((p) => p.provider === d.provider);
                return (
                  <button key={d.provider} onClick={() => setDriftProvider(d.provider)} className="hover:opacity-80" title={`Review new models for ${g?.displayName || d.provider}`}>
                    <Badge variant="warning" size="sm">{g?.displayName || d.provider} · {d.newModels.length} new</Badge>
                  </button>
                );
              })}
            </div>
          )}
          <ConfiguredTable
            rows={flatVisible}
            showProvider
            emptyMessage={q || hideDisabled ? "No models match the filter." : "No models configured."}
            resultsMap={resultsMap}
            liveResults={liveResults}
            testingKey={testingKey}
            copied={copied}
            disabled={disabledMap}
            onCopy={copyText}
            onTest={testOne}
            onToggleDisabled={toggleDisabled}
          />
          {flatSorted.length > flatVisible.length && (
            <div className="px-4 py-2 flex items-center justify-between border-t border-border">
              <span className="text-xs text-text-muted">Showing {flatVisible.length} of {flatSorted.length}</span>
              <Button size="sm" variant="secondary" icon="expand_more" onClick={() => setFlatLimit((l) => l + FLAT_PAGE)}>Load more</Button>
            </div>
          )}
        </div>
      ) : (
        <>
      {visibleGroups.length === 0 && <p className="text-sm text-text-muted">No providers match.</p>}

      {visibleGroups.map((group) => {
        const drift = driftByProvider[group.provider];
        const newCount = drift?.newModels?.length || 0;
        const counts = countsFor(group);
        const isOpen = expanded.has(group.provider);
        const limit = visibleCount[group.provider] || MATRIX_PAGE;
        const sortKey = sortSel[group.provider] || "";
        const cmp = sortComparator(sortKey);
        const baseItems = hideDisabled ? group.items.filter((item) => !isDis(group.provider, item.id)) : group.items;
        const sorted = cmp ? [...baseItems].sort(cmp) : baseItems;
        const visibleItems = sorted.slice(0, limit);

        return (
          <div key={group.provider} className="border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-surface-2/60 border-b border-border flex-wrap">
              <span className="material-symbols-outlined text-primary">dns</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold">{group.displayName}</h2>
                  <code className="text-xs text-text-muted font-mono bg-surface-2 px-1.5 py-0.5 rounded">{group.provider}</code>
                  <Badge variant={group.activeCount > 0 ? "success" : "default"} size="sm">{group.activeCount}/{group.connectionCount} active</Badge>
                  <Badge variant="default" size="sm">{group.itemCount} models</Badge>
                  {counts.ok > 0 && <Badge variant="success" size="sm">{counts.ok} ok</Badge>}
                  {counts.fail > 0 && <Badge variant="error" size="sm">{counts.fail} fail</Badge>}
                  {counts.untested > 0 && <Badge variant="default" size="sm">{counts.untested} untested</Badge>}
                  {newCount > 0 && (
                    <button onClick={() => setDriftProvider(group.provider)} className="hover:opacity-80" title="Review new models">
                      <Badge variant="warning" size="sm">{newCount} new</Badge>
                    </button>
                  )}
                  {drift?.removedModels?.length > 0 && <Badge variant="info" size="sm">{drift.removedModels.length} removed</Badge>}
                </div>
              </div>
              <span
                className={`material-symbols-outlined p-1.5 hover:bg-surface-2 rounded text-text-muted hover:text-primary transition-opacity ${busy === `drift:${group.provider}` ? "animate-spin" : ""}`}
                onClick={() => syncDrift(group.provider)}
                title="Sync drift for this provider"
              >sync</span>
              <Button size="sm" variant="secondary" icon="science" onClick={() => startTestProvider(group.provider)} disabled={sweep.running}>
                Test
              </Button>
              <button onClick={() => toggleExpand(group.provider)} className="p-1.5 hover:bg-surface-2 rounded text-text-muted hover:text-primary" title={isOpen ? "Collapse" : "Show models"}>
                <Chevron open={isOpen} />
              </button>
            </div>

            {drift && (newCount > 0 || drift.removedModels.length > 0 || drift.warning) && (
              <div className="px-4 py-2 bg-yellow-500/5 border-b border-border flex items-center gap-2 justify-between flex-wrap">
                <p className="text-xs text-text-muted">
                  {newCount > 0 && (
                    <button onClick={() => setDriftProvider(group.provider)} className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-600 dark:text-yellow-400 hover:underline">
                      {newCount} new on /models
                    </button>
                  )}
                  {newCount > 0 && drift.removedModels.length > 0 ? " · " : ""}
                  {drift.removedModels.length > 0 && <span>removed {drift.removedModels.length}</span>}
                  {` · live ${drift.liveModels.length} · ${getRelativeTime(drift.fetchedAt)}`}
                  {drift.warning && <span className="text-red-500"> · sync failed ({drift.warning})</span>}
                </p>
                {newCount > 0 && (
                  <Button size="sm" icon="ballot" onClick={() => setDriftProvider(group.provider)}>Review &amp; import</Button>
                )}
              </div>
            )}

            {group.liveError && (
              <p className="px-4 py-2 text-xs text-red-500 bg-red-500/5 border-b border-border">Live fetch failed: {group.liveError}</p>
            )}

            {isOpen && (
              <div className="flex flex-col">
                <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs text-text-muted">{baseItems.length} models</span>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortSel((prev) => ({ ...prev, [group.provider]: e.target.value }))}
                    className="px-2 py-1 text-xs text-text-muted bg-background border border-border rounded-md focus:outline-none focus:border-primary"
                    title="Sort models in this table"
                  >
                    {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <ConfiguredTable
                  rows={visibleItems.map((item) => ({ group, item }))}
                  emptyMessage={group.liveError ? `No models — live fetch failed: ${group.liveError}` : baseItems.length === 0 && group.items.length > 0 ? "All models hidden (disabled filter)." : "No models configured for this provider."}
                  resultsMap={resultsMap}
                  liveResults={liveResults}
                  testingKey={testingKey}
                  copied={copied}
                  disabled={disabledMap}
                  onCopy={copyText}
                  onTest={testOne}
                  onToggleDisabled={toggleDisabled}
                />
                {sorted.length > visibleItems.length && (
                  <div className="px-4 py-2 flex items-center justify-between border-t border-border">
                    <span className="text-xs text-text-muted">Showing {visibleItems.length} of {sorted.length}</span>
                    <Button size="sm" variant="secondary" icon="expand_more" onClick={() => loadMore(group.provider)}>Load more</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
        </>
      )}

      {driftGroup && (
        <DriftModal
          group={driftGroup}
          drift={driftByProvider[driftGroup.provider]}
          selectedNew={selectedNew}
          onImport={importSelected}
          onToggleSelectNew={toggleSelectNew}
          onToggleSelectAllNew={toggleSelectAllNew}
          onClose={() => setDriftProvider(null)}
        />
      )}
    </div>
  );
}