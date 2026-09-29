// Model Lab → "Săn Free" tab: free (price-0) candidates from the synced
// catalog, freeTier provider packs to connect, and live quota balances.
// Approve is a two-step button: click arms it ("Xác nhận?"), click again adds
// the model to the `free` combo (and enables it in the lab).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge } from "@/shared/components";

const rowKey = (c) => `${c.provider}|${c.model}`;

function formatContext(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function formatUsd(n) {
  if (!Number.isFinite(n)) return null;
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

export default function ModelsLabFreeTab({ search = "", disabled = false, liveResults = null }) {
  const router = useRouter();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tests, setTests] = useState({});
  const [testingKey, setTestingKey] = useState(null);
  const [arming, setArming] = useState(null);
  const [approving, setApproving] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/models/free");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load free report");
      setReport(data);
      setError("");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => { await load(); };
    init();
  }, [load]);

  // Stream probe: proves bytes flow to completion, not just a one-shot 200.
  const testOne = useCallback(async (c) => {
    const key = rowKey(c);
    if (testingKey) return;
    setTestingKey(key);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${c.alias}/${c.model}`, kind: "llm", stream: true }),
      });
      const data = await res.json();
      setTests((prev) => ({
        ...prev,
        [key]: { ok: !!data.ok, latencyMs: data.latencyMs ?? null, ttfbMs: data.ttfbMs ?? null, error: data.error ?? null, testedAt: new Date().toISOString() },
      }));
    } catch {
      setTests((prev) => ({ ...prev, [key]: { ok: false, latencyMs: null, error: "Network error", testedAt: new Date().toISOString() } }));
    } finally {
      setTestingKey(null);
    }
  }, [testingKey]);

  const approve = useCallback(async (c) => {
    const key = rowKey(c);
    if (arming !== key) {
      setArming(key);
      setTimeout(() => setArming((a) => (a === key ? null : a)), 4000);
      return;
    }
    setApproving(key);
    try {
      const res = await fetch("/api/models/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", provider: c.provider, model: c.model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approve failed");
      setReport((prev) => prev
        ? { ...prev, candidates: prev.candidates.map((x) => (x.provider === c.provider && x.model === c.model ? { ...x, inFreeCombo: true } : x)) }
        : prev);
      setArming(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setApproving(null);
    }
  }, [arming]);

  if (loading) return <p className="text-sm text-text-muted">Loading free candidates…</p>;

  const q = search.trim().toLowerCase();
  const candidates = (report?.candidates || []).filter((c) =>
    !q || `${c.displayName} ${c.provider} ${c.alias} ${c.model} ${c.name}`.toLowerCase().includes(q)
  );
  const packs = (report?.packs || []).filter((p) => !q || `${p.name} ${p.provider} ${p.alias}`.toLowerCase().includes(q));
  const quotas = report?.quotas || [];

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-500 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

      {!report?.catalogReady && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2">
          Price catalog not synced yet — run Sync in the Model Library bar above to load free prices from models.dev.
        </p>
      )}

      {quotas.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Free within your quota</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {quotas.map((row) => {
              const usd = formatUsd(row.usd);
              return (
                <div key={row.provider} className="border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{row.name}</p>
                    <p className="text-xs text-text-muted truncate">
                      {row.connectionName ? `${row.connectionName} · ` : ""}
                      {row.pct != null ? `${row.pct}% left` : usd ? `${usd} left` : "balance available"}
                    </p>
                  </div>
                  <Badge variant={row.empty ? "error" : "success"} size="sm">{row.empty ? "empty" : "quota"}</Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-text-muted">
            <span className="font-semibold text-text">Free models (price 0 / 0)</span>
            {` · ${candidates.length} candidates`}
            {report?.freeCombo?.length ? ` · ${report.freeCombo.length} in combo "free"` : ""}
          </p>
        </div>
        {candidates.length === 0 ? (
          <p className="px-4 py-4 text-sm text-text-muted">
            {report?.catalogReady ? "No free models match this filter." : "Waiting for the price catalog."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border">
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium text-right">Context</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const key = rowKey(c);
                  // Row-local stream probe wins; otherwise show the live sweep
                  // ("Test free" job) result for the same provider|kind|model.
                  const t = tests[key] || liveResults?.[`${c.provider}|llm|${c.model}`] || null;
                  return (
                    <tr key={key} className="border-b border-border last:border-0 hover:bg-surface-1/50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-text-muted text-xs">{c.displayName}</span>
                        {!c.connected && <span className="ml-1.5 text-xs text-yellow-600 dark:text-yellow-400" title="Provider not connected — connect it to use these models">not connected</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{c.model}</span>
                        {c.isNew && <span className="ml-1.5"><Badge variant="warning" size="sm">new</Badge></span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-muted text-right tabular-nums">{formatContext(c.context)}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {c.inFreeCombo && <Badge variant="success" size="sm">in combo free</Badge>}
                        {t && (
                          <span className={t.ok ? "text-green-500" : "text-red-500"} title={t.error || ""}>
                            {t.ok ? ` alive ${t.ttfbMs != null ? `· ttfb ${t.ttfbMs}ms` : t.latencyMs != null ? `· ${t.latencyMs}ms` : ""}` : ` fail: ${(t.error || "").slice(0, 60)}`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => testOne(c)}
                            disabled={testingKey === key || disabled}
                            className="p-1.5 hover:bg-surface-2 rounded text-text-muted hover:text-primary transition-colors disabled:opacity-40"
                            title="Stream-probe this model (proves the stream completes)"
                          >
                            <span className="material-symbols-outlined text-base">science</span>
                          </button>
                          {c.connected ? (
                            c.inFreeCombo ? (
                              <span className="text-xs text-text-muted px-2">added ✓</span>
                            ) : (
                              <Button
                                size="sm"
                                variant={arming === key ? "primary" : "secondary"}
                                onClick={() => approve(c)}
                                disabled={approving === key}
                                loading={approving === key}
                              >
                                {arming === key ? "Xác nhận thêm?" : "Thêm"}
                              </Button>
                            )
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => router.push("/dashboard/providers")}>Connect</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {packs.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Free-tier providers <span className="text-text-muted font-normal">— connect one to route through it</span></h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {packs.map((p) => (
              <div key={p.provider} className="border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-text-muted truncate">{p.modelCount} models{p.connected ? " · connected" : ""}</p>
                </div>
                {p.connected
                  ? <Badge variant="success" size="sm">connected</Badge>
                  : <Button size="sm" variant="secondary" onClick={() => router.push("/dashboard/providers")}>Connect</Button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
