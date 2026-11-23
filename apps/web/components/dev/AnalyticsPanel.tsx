'use client';

/**
 * GAP-31 Phase 3 (DR-13) — Observability panel (design §5).
 *
 * A developer-oriented panel (gated behind a dev toggle in `page.tsx`; not part
 * of the default player UI) that surfaces local-only analytics for development
 * + balancing review. Reads the store through the read-only query API in
 * `lib/analytics/analytics.ts` — it NEVER touches `simState` (rule 6: rendering /
 * UI reads state, never writes the sim).
 *
 * Sections (design §5):
 *   - Event counts by category (gameplay / simulation / performance / error).
 *   - Recent gameplay events (the high-signal events from Phase 1's bridge).
 *   - Tree growth + environmental + economic summaries (the periodic sim-summary
 *     from Phase 2 — latest snapshot + a chronological trend table).
 *   - Simulation tick performance (sampled tick duration + frame FPS — latest +
 *     min/avg/max over the recent sample).
 *   - Error history (every caught exception / ErrorBoundary event / load failure).
 *   - IndexedDB storage usage (the analytics footprint + the effect of retention).
 *   - Export diagnostics as JSON (a full dump for bug reports / balancing review).
 *   - Clear analytics history (the reset control — wipes ONLY analytics, never
 *     the save blob; design §7).
 *
 * Auto-refreshes every 5s while open; manual Refresh + Close controls.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalyticsEvent, AnalyticsEventCategory } from '@capitalist-tree/analytics';
import {
  clearAnalytics,
  countAnalyticsByCategory,
  exportAnalyticsJson,
  queryAnalyticsEvents,
} from '../../lib/analytics/analytics';

interface AnalyticsPanelProps {
  /** Whether the panel overlay is shown. */
  readonly open: boolean;
  /** Close the panel (the parent toggle). */
  readonly onClose: () => void;
}

const ZERO_COUNTS: Record<AnalyticsEventCategory, number> = {
  gameplay: 0,
  simulation: 0,
  performance: 0,
  error: 0,
};

const CATEGORY_LABEL: Record<AnalyticsEventCategory, string> = {
  gameplay: 'Gameplay',
  simulation: 'Simulation',
  performance: 'Performance',
  error: 'Error',
};

const CATEGORY_TONE: Record<AnalyticsEventCategory, string> = {
  gameplay: 'text-leaf-dark',
  simulation: 'text-sky-800',
  performance: 'text-brass-2',
  error: 'text-accent',
};

export function AnalyticsPanel({ open, onClose }: AnalyticsPanelProps): React.ReactNode {
  const [counts, setCounts] = useState<Record<AnalyticsEventCategory, number>>(ZERO_COUNTS);
  const [recentGameplay, setRecentGameplay] = useState<readonly AnalyticsEvent[]>([]);
  const [summaries, setSummaries] = useState<readonly AnalyticsEvent[]>([]);
  const [perfEvents, setPerfEvents] = useState<readonly AnalyticsEvent[]>([]);
  const [errors, setErrors] = useState<readonly AnalyticsEvent[]>([]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number } | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);

  const refresh = useCallback(async () => {
    const [c, gameplay, su, perf, errs] = await Promise.all([
      countAnalyticsByCategory(),
      queryAnalyticsEvents({ category: 'gameplay', limit: 20 }),
      queryAnalyticsEvents({ event: 'sim-summary', limit: 50 }),
      queryAnalyticsEvents({ event: 'tick-perf', limit: 20 }),
      queryAnalyticsEvents({ category: 'error', limit: 50 }),
    ]);
    setCounts(c);
    setRecentGameplay(gameplay);
    setSummaries(su);
    setPerfEvents(perf);
    setErrors(errs);
    setLastRefreshed(Date.now());
    if (typeof navigator !== 'undefined' && typeof navigator.storage?.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        // exactOptionalPropertyTypes: build the object conditionally so absent
        // fields stay absent (not explicitly undefined).
        const next: { usage?: number; quota?: number } = {};
        if (est.usage !== undefined) next.usage = est.usage;
        if (est.quota !== undefined) next.quota = est.quota;
        setStorage(next);
      } catch {
        setStorage(null);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [open, refresh]);

  const handleExport = useCallback(async () => {
    const json = await exportAnalyticsJson();
    downloadText('analytics-diagnostics.json', json, 'application/json');
  }, []);

  const handleClear = useCallback(async () => {
    // `confirm` is a browser primitive; the panel is client-only + dev-gated.
    if (typeof window === 'undefined' || !window.confirm(
      'Clear all analytics history? This cannot be undone. The save blob is untouched.',
    )) {
      return;
    }
    await clearAnalytics();
    void refresh();
  }, [refresh]);

  const perfAgg = useMemo(() => aggregatePerf(perfEvents), [perfEvents]);
  // summaries come most-recent first; reverse for a chronological trend table.
  const summaryTrend = useMemo(() => summaries.slice().reverse(), [summaries]);

  if (!open) return null;

  const totalEvents = counts.gameplay + counts.simulation + counts.performance + counts.error;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Analytics observability panel"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-parchment-2/80 p-2 sm:p-6 backdrop-blur-sm"
    >
      <div className="my-4 w-full max-w-5xl rounded-lg border border-ink bg-parchment text-ink shadow-xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink p-3 sm:p-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Analytics observability</h2>
            <p className="text-[11px] text-ink-2">
              Local-only · {totalEvents} event{totalEvents === 1 ? '' : 's'} stored ·
              refreshed {lastRefreshed ? new Date(lastRefreshed).toLocaleTimeString() : '—'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md bg-parchment-3 hover:bg-parchment-3 px-3 py-1.5 text-xs font-medium text-ink transition-colors"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              className="rounded-md bg-sky-700 hover:bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => void handleClear()}
              className="rounded-md bg-rose-800 hover:bg-rose-700 px-3 py-1.5 text-xs font-medium text-white transition-colors"
            >
              Clear history
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-parchment-3 hover:bg-parchment-3 px-3 py-1.5 text-xs font-medium text-ink transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-5 p-3 sm:p-5">
          {/* Counts by category */}
          <section>
            <SectionTitle>Event counts by category</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(counts) as AnalyticsEventCategory[]).map((cat) => (
                <div
                  key={cat}
                  className="rounded-md border border-ink bg-parchment-2/40 p-3"
                  data-testid={`count-${cat}`}
                >
                  <div className={`text-lg font-semibold ${CATEGORY_TONE[cat]}`}>
                    {counts[cat]}
                  </div>
                  <div className="text-[11px] text-ink-2">{CATEGORY_LABEL[cat]}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Sim summaries: latest + trend */}
          <section>
            <SectionTitle>Tree growth · environment · economy (sim-day summaries)</SectionTitle>
            <SummaryLatest event={summaries[0]} />
            <div className="mt-2 overflow-x-auto rounded-md border border-ink">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-parchment-3/60 text-ink">
                  <tr>
                    <th className="p-2">Sim day</th>
                    <th className="p-2">Height</th>
                    <th className="p-2">Diameter</th>
                    <th className="p-2">Health</th>
                    <th className="p-2">Reserves</th>
                    <th className="p-2">Alive</th>
                    <th className="p-2">Air</th>
                    <th className="p-2">Ocean</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryTrend.length === 0 ? (
                    <tr><td colSpan={8} className="p-2 text-ink-soft">No summaries yet (one per sim-day).</td></tr>
                  ) : (
                    summaryTrend.slice(-12).map((ev) => (
                      <SummaryRow key={ev.id} event={ev} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Performance */}
          <section>
            <SectionTitle>Simulation tick performance (sampled)</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Latest tick (ms)" value={perfAgg.latestMs} />
              <Stat label="Avg (ms)" value={perfAgg.avgMs} />
              <Stat label="Max (ms)" value={perfAgg.maxMs} />
              <Stat label="Latest FPS" value={perfAgg.latestFps} />
            </div>
            {perfEvents.length === 0 ? (
              <p className="mt-2 text-[11px] text-ink-soft">
                No perf samples yet (one every ~60 ticks while the sim runs).
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-md border border-ink">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-parchment-3/60 text-ink">
                    <tr>
                      <th className="p-2">Tick</th>
                      <th className="p-2">Duration (ms)</th>
                      <th className="p-2">FPS</th>
                      <th className="p-2">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfEvents.slice(0, 10).map((ev) => (
                      <tr key={ev.id} className="border-t border-ink">
                        <td className="p-2 font-journal">{String((ev.data as { tick?: number }).tick ?? '—')}</td>
                        <td className="p-2 font-journal">{fmtNum((ev.data as { tickDurationMs?: number }).tickDurationMs)}</td>
                        <td className="p-2 font-journal">{String((ev.data as { fps?: number }).fps ?? '—')}</td>
                        <td className="p-2 text-ink-2">{new Date(ev.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Error history */}
          <section>
            <SectionTitle>Error history</SectionTitle>
            {errors.length === 0 ? (
              <p className="text-[11px] text-ink-soft">No errors recorded.</p>
            ) : (
              <ul className="space-y-1 text-[11px]">
                {errors.slice(0, 20).map((ev) => (
                  <li key={ev.id} className="rounded-md border border-rose-900/40 bg-rose-950/20 p-2">
                    <div className="font-journal text-accent">{ev.event}</div>
                    <div className="text-ink">
                      {String((ev.data as { message?: string }).message ?? '')}
                    </div>
                    <div className="text-[10px] text-ink-soft">
                      {new Date(ev.timestamp).toLocaleString()}
                      {typeof (ev.data as { componentStack?: unknown }).componentStack === 'string'
                        ? ' · render error'
                        : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent gameplay events */}
          <section>
            <SectionTitle>Recent gameplay events</SectionTitle>
            {recentGameplay.length === 0 ? (
              <p className="text-[11px] text-ink-soft">No gameplay events yet.</p>
            ) : (
              <ul className="space-y-1 text-[11px]">
                {recentGameplay.slice(0, 15).map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between rounded-md border border-ink bg-parchment-2/40 p-2">
                    <span className="font-journal text-leaf-dark">{ev.event}</span>
                    <span className="text-[10px] text-ink-soft">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Storage usage */}
          <section>
            <SectionTitle>IndexedDB storage usage</SectionTitle>
            {storage?.usage !== undefined ? (
              <p className="text-[11px] text-ink">
                Analytics footprint: <span className="font-journal">{formatBytes(storage.usage)}</span>
                {storage.quota !== undefined ? (
                  <> of <span className="font-journal">{formatBytes(storage.quota)}</span> quota
                    ({((storage.usage / storage.quota) * 100).toFixed(2)}%)</>
                ) : null}
                . The save DB is separate + unaffected.
              </p>
            ) : (
              <p className="text-[11px] text-ink-soft">
                Storage estimate unavailable (navigator.storage.estimate not supported / not in a
                secure context). The save DB is always separate + unaffected.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── subcomponents ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { readonly children: React.ReactNode }): React.ReactNode {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-2">{children}</h3>;
}

function Stat({ label, value }: { readonly label: string; readonly value: number | null }): React.ReactNode {
  return (
    <div className="rounded-md border border-ink bg-parchment-2/40 p-3">
      <div className="text-lg font-semibold text-brass-2">{value === null ? '—' : value}</div>
      <div className="text-[11px] text-ink-2">{label}</div>
    </div>
  );
}

/** The latest sim-summary rendered as a compact stat block. */
function SummaryLatest({ event }: { readonly event: AnalyticsEvent | undefined }): React.ReactNode {
  if (!event) {
    return <p className="text-[11px] text-ink-soft">No summary yet (the first fires after one sim-day).</p>;
  }
  const d = event.data as {
    elapsedSeconds?: number;
    tree?: { alive?: boolean; ageDays?: number; height?: number; trunkDiameter?: number; health?: number; energyReserves?: number };
    environment?: { airQuality?: number; oceanHealth?: number };
    economy?: { totalIssued?: string };
  };
  const day = d.elapsedSeconds !== undefined ? Math.floor(d.elapsedSeconds / 86_400) : null;
  return (
    <div className="rounded-md border border-ink bg-parchment-2/40 p-3 text-[11px]">
      <div className="mb-1 text-ink-2">Latest (sim-day {day ?? '—'})</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <KV k="Height" v={fmtNum(d.tree?.height)} />
        <KV k="Diameter" v={fmtNum(d.tree?.trunkDiameter)} />
        <KV k="Health" v={fmtNum(d.tree?.health)} />
        <KV k="Reserves" v={fmtNum(d.tree?.energyReserves)} />
        <KV k="Air quality" v={fmtNum(d.environment?.airQuality)} />
        <KV k="Ocean health" v={fmtNum(d.environment?.oceanHealth)} />
        <KV k="Currency issued" v={d.economy?.totalIssued ?? '—'} />
        <KV k="Alive" v={d.tree?.alive === undefined ? '—' : d.tree.alive ? 'yes' : 'no'} />
      </div>
    </div>
  );
}

function SummaryRow({ event }: { readonly event: AnalyticsEvent }): React.ReactNode {
  const d = event.data as {
    elapsedSeconds?: number;
    tree?: { height?: number; trunkDiameter?: number; health?: number; energyReserves?: number; alive?: boolean };
    environment?: { airQuality?: number; oceanHealth?: number };
  };
  return (
    <tr className="border-t border-ink">
      <td className="p-2 font-journal">{d.elapsedSeconds !== undefined ? Math.floor(d.elapsedSeconds / 86_400) : '—'}</td>
      <td className="p-2 font-journal">{fmtNum(d.tree?.height)}</td>
      <td className="p-2 font-journal">{fmtNum(d.tree?.trunkDiameter)}</td>
      <td className="p-2 font-journal">{fmtNum(d.tree?.health)}</td>
      <td className="p-2 font-journal">{fmtNum(d.tree?.energyReserves)}</td>
      <td className="p-2 font-journal">{d.tree?.alive ? 'yes' : 'no'}</td>
      <td className="p-2 font-journal">{fmtNum(d.environment?.airQuality)}</td>
      <td className="p-2 font-journal">{fmtNum(d.environment?.oceanHealth)}</td>
    </tr>
  );
}

function KV({ k, v }: { readonly k: string; readonly v: string }): React.ReactNode {
  return (
    <div>
      <span className="text-ink-soft">{k}: </span>
      <span className="font-journal text-ink">{v}</span>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

interface PerfAggregate {
  latestMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  latestFps: number | null;
}

function aggregatePerf(events: readonly AnalyticsEvent[]): PerfAggregate {
  if (events.length === 0) return { latestMs: null, avgMs: null, maxMs: null, latestFps: null };
  const durations = events.map((e) => (e.data as { tickDurationMs?: number }).tickDurationMs ?? 0);
  const sum = durations.reduce((a, b) => a + b, 0);
  const max = durations.reduce((a, b) => Math.max(a, b), 0);
  const latest = events[0];
  return {
    latestMs: (latest?.data as { tickDurationMs?: number }).tickDurationMs ?? null,
    avgMs: Math.round((sum / durations.length) * 1000) / 1000,
    maxMs: Math.round(max * 1000) / 1000,
    latestFps: (latest?.data as { fps?: number }).fps ?? null,
  };
}

function fmtNum(n: number | undefined): string {
  if (n === undefined) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Trigger a client-side download of a text blob (the JSON diagnostics dump). */
function downloadText(filename: string, content: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
