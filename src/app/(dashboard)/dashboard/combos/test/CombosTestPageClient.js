"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, Button, CardSkeleton, Badge } from "@/shared/components";

function statusBadge(result) {
  if (result?.done) {
    return result.ok ? (
      <Badge variant="success">OK</Badge>
    ) : (
      <Badge variant="error">Failed</Badge>
    );
  }
  if (result?.testing) {
    return <Badge variant="info">Testing…</Badge>;
  }
  return <Badge variant="default">Pending</Badge>;
}

function timeText(result) {
  if (result?.done) {
    return `${result.latencyMs} ms`;
  }
  return "—";
}

function CombosTestClient({ comboId }) {
  const router = useRouter();
  const [combo, setCombo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState({});
  const [sortByTime, setSortByTime] = useState(false);
  const [marked, setMarked] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [appliedMsg, setAppliedMsg] = useState("");

  // Load the combo (by id or name) then kick off the test.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/combos");
        const data = res.ok ? await res.json() : { combos: [] };
        const combos = data.combos || [];
        const found =
          combos.find((c) => String(c.id) === String(comboId)) ||
          combos.find((c) => c.name === comboId);
        if (cancelled) return;
        setCombo(found || null);
      } catch (error) {
        if (cancelled) return;
        console.log("Error fetching combo:", error);
        setCombo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [comboId]);

  const models = useMemo(() => combo?.models || [], [combo]);

  const abortRef = useRef(null);
  const runningRef = useRef(false);

  const runTest = useCallback(async (testModels) => {
    if (!testModels || testModels.length === 0) return;
    if (runningRef.current) return;
    runningRef.current = true;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setTesting(true);
    setAppliedMsg("");
    setResults({});

    // Run models sequentially: one at a time.
    for (const model of testModels) {
      if (controller.signal.aborted) return;
      setResults((prev) => ({ ...prev, [model]: { testing: true } }));
      try {
        const res = await fetch("/api/models/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, kind: "llm" }),
          signal: AbortSignal.timeout(20000),
        });
        const data = await res.json().catch(() => ({}));
        const result = {
          model,
          ok: data.ok === true,
          latencyMs: data.latencyMs || 0,
          error: data.error || null,
          status: data.status ?? (res.ok ? null : res.status),
          done: true,
        };
        setResults((prev) => ({ ...prev, [model]: result }));
      } catch (error) {
        if (controller.signal.aborted) return;
        const result = {
          model,
          ok: false,
          latencyMs: 0,
          error: error.name === "TimeoutError" ? "Timed out" : error.message,
          status: null,
          done: true,
        };
        setResults((prev) => ({ ...prev, [model]: result }));
      }
    }

    if (controller.signal.aborted) {
      runningRef.current = false;
      return;
    }

    setTesting(false);
    runningRef.current = false;
  }, []);

  const handleRerun = () => {
    if (models.length > 0 && !testing) runTest(models);
  };

  const handleSort = () => {
    if (testing) return;
    setSortByTime((prev) => !prev);
  };

  const toggleMarked = (model) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  // Apply: actually remove the currently-marked models from the combo.
  const handleApply = async () => {
    if (marked.size === 0 || applying) return;
    const remaining = models.filter((m) => !marked.has(m));
    if (remaining.length === models.length) return;
    setApplying(true);
    setAppliedMsg("");
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: remaining }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCombo(updated);
        setMarked(new Set());
        setResults({});
        setAppliedMsg(`Removed ${models.length - remaining.length} failed model(s) from "${combo.name}".`);
      } else {
        const err = await res.json().catch(() => ({}));
        setAppliedMsg(err.error || "Failed to apply removal");
      }
    } catch (error) {
      console.log("Error removing failed models:", error);
      setAppliedMsg("Failed to apply removal");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!combo) {
    return (
      <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0">
        <Button variant="ghost" size="sm" icon="arrow_back" onClick={() => router.push("/dashboard/combos")}>
          Back to Combos
        </Button>
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">search_off</span>
            </div>
            <p className="text-text-main font-medium mb-1">Combo not found</p>
            <p className="text-sm text-text-muted">Select a combo from the combos page to test.</p>
          </div>
        </Card>
      </div>
    );
  }

  const passed = Object.values(results).filter((r) => r?.ok).length;
  const failed = Object.values(results).filter((r) => r?.done && !r?.ok).length;

  // Sort: OK models by response time, failed models pinned to bottom.
  let sortedModels = models;
  if (sortByTime) {
    const okModels = models.filter((m) => results[m]?.ok);
    const failedModels = models.filter((m) => !results[m]?.ok);
    const sorted = [...okModels].sort((a, b) => {
      const latA = results[a]?.latencyMs ?? Infinity;
      const latB = results[b]?.latencyMs ?? Infinity;
      return latA - latB;
    });
    sortedModels = [...sorted, ...failedModels];
  }

  const removeableCount = sortedModels.filter((m) => marked.has(m)).length;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" icon="arrow_back" onClick={() => router.push("/dashboard/combos")}>
            Combos
          </Button>
          <div>
            <p className="text-sm font-medium truncate">
              Test Combo — <code className="font-mono">{combo.name}</code>
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              Pinging each model through the gateway to check status and latency.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button
            icon="delete"
            variant="danger"
            onClick={handleApply}
            disabled={applying || removeableCount === 0}
            className="w-full sm:w-auto whitespace-nowrap"
          >
            {applying
              ? "Removing…"
              : removeableCount > 0
                ? `Remove Marked (${removeableCount})`
                : "Remove Marked"}
          </Button>
          <Button
            icon="sort"
            variant={sortByTime ? "primary" : "secondary"}
            onClick={handleSort}
            disabled={testing || passed === 0}
            className="w-full sm:w-auto whitespace-nowrap"
          >
            {sortByTime ? "Sorted by Time" : "Sort by Time"}
          </Button>
          <Button icon="refresh" onClick={handleRerun} disabled={testing} className="w-full sm:w-auto whitespace-nowrap">
            {testing ? "Testing…" : "Run Test"}
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-text-muted">
          <span className="font-medium text-text-main">{models.length}</span> models
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
          <span className="size-2 rounded-full bg-emerald-500" /> {passed} OK
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-red-500">
          <span className="size-2 rounded-full bg-red-500" /> {failed} Failed
        </span>
        {marked.size > 0 && (
          <span className="text-xs text-text-muted">
            {removeableCount} marked for removal — Apply to save
          </span>
        )}
      </div>

      {appliedMsg && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-500">
          {appliedMsg}
        </div>
      )}

      {/* Result table */}
      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left">
                <th className="w-10 px-4 py-3">
                  <span className="sr-only">Remove</span>
                </th>
                <th className="px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide">Model</th>
                <th className="px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 font-medium text-text-muted text-xs uppercase tracking-wide">Response Time</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((model) => {
                const result = results[model];
                const canRemove = result?.done && !result?.ok;
                const isMarked = marked.has(model);
                return (
                  <tr
                    key={`${model}::${sortByTime}`}
                    className={`border-b border-black/5 dark:border-white/5 last:border-0 ${isMarked ? "bg-red-500/5" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isMarked}
                        disabled={!canRemove}
                        onChange={() => canRemove && toggleMarked(model)}
                        title={canRemove ? "Mark for removal" : "Only failed models can be removed"}
                        className="size-4 accent-red-500 disabled:opacity-30"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <code className="font-mono text-xs text-text-main">{model}</code>
                      {result?.error && (
                        <div className="mt-1 text-xs text-red-500 break-words" title={result.error}>
                          {result.error}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{statusBadge(result)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">{timeText(result)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function CombosTestPageClient() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CombosTestRoute />
    </Suspense>
  );
}

function CombosTestRoute() {
  const searchParams = useSearchParams();
  const comboId = searchParams.get("combo") || "";
  return <CombosTestClient key={comboId} comboId={comboId} />;
}
