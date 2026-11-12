/**
 * OfflineModal — "While You Were Away" summary modal (P6d2 — TDD §14.4,
 * GDD §4.2).
 *
 * Renders an `OfflineSummary` produced by the P6a catch-up processor and
 * parked on the UI slice (`ui.pendingOfflineSummary`) by the catch-up-on-load
 * trigger (`lib/persistence/offline-catch-up-trigger.ts`). The modal is the
 * ONLY surfacing of the summary — once dismissed (Continue), the summary is
 * cleared from the UI slice and the player resumes play.
 *
 * Sections (per the P6d2 brief):
 *   - **Header**: "While You Were Away" + the time bounds
 *     (`fromDay → toDay`, formatted as "Day 5 → Day 47" or, when the absence
 *     spans a sim-year boundary, "Year 1 Day 5 → Year 2 Day 12").
 *   - **Workload**: "Simulated X sim days in Y chunks" + a capped warning
 *     when `summary.capped === true` ("Your absence exceeded the 30-day cap;
 *     only the first 30 real days were simulated.").
 *   - **Biological deltas**: height, trunkDiameter, currentLeaves,
 *     energyReserves, waterStored, health, stress (before → after + delta
 *     badge; stress uses an inverted tone so a rise reads as bad). A special
 *     "Your tree died while you were away." line in red when
 *     `alive.before && !alive.after`.
 *   - **Economic deltas**: personalCash, monetarySupply, inflationIndex,
 *     totalIssued (money-formatted before → after + delta), plus a
 *     transactionsCount summary ("X transactions recorded").
 *   - **Environmental deltas**: soilWater, freshwaterAvailability,
 *     biodiversityIndex, forestCoverage, globalTemperature, co2Concentration.
 *   - **Dismiss**: a "Continue" button that clears `pendingOfflineSummary`.
 *
 * Architecture:
 *   - Rule 6 (TDD §15.1, GDD §6.1): rendering / UI reads state, NEVER writes.
 *     The modal reads `ui.pendingOfflineSummary` via a narrow Zustand selector
 *     and clears it via `clearPendingOfflineSummary` (a UI mutator —
 *     `simState` is referentially untouched; the catch-up already committed
 *     its state via `commitSimState` at load time). The modal NEVER runs
 *     simulation logic — the catch-up ran at load; the modal only displays
 *     the report.
 *   - Rule 2 (purity): the day-range + money-delta formatters are pure; the
 *     modal's render is a pure function of its subscribed slice.
 *   - TDD §16 selective UI updates: the modal subscribes to a single
 *     `ui.pendingOfflineSummary` reference — it re-renders only when the
 *     summary is parked or cleared, not on every sim tick.
 *
 * Returns `null` when `pendingOfflineSummary` is null (no modal to show).
 */
'use client';

import { useCallback, type ReactElement } from 'react';
import type { OfflineSummary, OfflineSummaryDelta } from '@capitalist-tree/shared';
import { PROVISIONAL_DAYS_PER_YEAR } from '@capitalist-tree/shared';
import { useGameStore } from '../../stores/game-store';
import { formatMoneyFromStr } from '../../lib/format/money';
import { Button } from '../common/Button';
import { OfflineDeltaRow } from './OfflineDeltaRow';

// ----------------------------------------------------------------------------
// Pure formatters.
// ----------------------------------------------------------------------------

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Format a single in-game day counter (0-indexed per the clock schema) as a
 * 1-indexed "Year X Day Y" label. Year 1 is the first 120 sim days
 * (`PROVISIONAL_DAYS_PER_YEAR`); Year 2 starts at day 120, etc.
 *
 * Pure. Mirrors the AutomationPanel's 1-indexed `Day N` convention but adds
 * the year prefix the offline summary needs (a 30-real-day absence ≈ 15 sim
 * years at factor 60 — the year matters).
 */
function formatDayLabel(day: number): string {
  if (!Number.isFinite(day) || day < 0) return 'Day 1';
  const year = Math.floor(day / PROVISIONAL_DAYS_PER_YEAR) + 1;
  const dayOfYear = (day % PROVISIONAL_DAYS_PER_YEAR) + 1;
  return `Year ${year} Day ${dayOfYear}`;
}

/**
 * Format the catch-up's day bounds as a human range. When both bounds fall in
 * the same sim year, the year prefix is collapsed (e.g. "Day 5 → Day 47");
 * when the absence spans a year boundary, both carry the year
 * (e.g. "Year 1 Day 5 → Year 2 Day 12"). Pure.
 */
function formatDayRange(fromDay: number, toDay: number): string {
  if (!Number.isFinite(fromDay) || !Number.isFinite(toDay)) {
    return '—';
  }
  const fromYear = Math.floor(fromDay / PROVISIONAL_DAYS_PER_YEAR) + 1;
  const toYear = Math.floor(toDay / PROVISIONAL_DAYS_PER_YEAR) + 1;
  const fromDayOfYear = (fromDay % PROVISIONAL_DAYS_PER_YEAR) + 1;
  const toDayOfYear = (toDay % PROVISIONAL_DAYS_PER_YEAR) + 1;
  if (fromYear === toYear) {
    return `Day ${fromDayOfYear} → Day ${toDayOfYear}`;
  }
  return `Year ${fromYear} Day ${fromDayOfYear} → Year ${toYear} Day ${toDayOfYear}`;
}

/**
 * Format a numeric delta as a signed, 1-decimal string (e.g. `+12.3`,
 * `-0.4`, `+0.0`). Pure.
 */
function formatSignedDelta(delta: number): string {
  if (!Number.isFinite(delta)) return '0.0';
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return `${sign}${Math.abs(delta).toFixed(1)}`;
}

/**
 * Format a [0, 1] health/stress/coverage value as a percentage. Pure.
 */
function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * Format a money delta from bigint-as-string before/after. Pure. Returns the
 * signed display string (e.g. `+$5.00`, `-$20.00`, `+$0.00`).
 */
function formatMoneyDelta(before: string, after: string): { text: string; delta: number } {
  const beforeN = parseSafeBigInt(before);
  const afterN = parseSafeBigInt(after);
  const diff = afterN - beforeN;
  // BigInt → sign string. formatSignedMoney expects a bigint.
  const sign = diff < 0n ? '-' : '+';
  const absStr = (diff < 0n ? -diff : diff).toString(10);
  // Reuse formatMoneyFromStr for grouping + cents.
  const formatted = formatMoneyFromStr(absStr);
  return { text: `${sign}${formatted}`, delta: Number(diff) };
}

function parseSafeBigInt(s: string): bigint {
  if (typeof s !== 'string' || !/^-?\d+$/.test(s)) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

/**
 * Convert sim-seconds to a 1-indexed sim-day count (floored). Pure. Used for
 * the "Simulated X sim days" workload line.
 */
function simSecondsToDays(seconds: number): number {
  return Math.floor(seconds / SECONDS_PER_DAY);
}

// ----------------------------------------------------------------------------
// Section renderers (pure — given a summary slice, return a list of rows).
// ----------------------------------------------------------------------------

interface RowSpec {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly deltaText: string;
  readonly delta: number;
  readonly tone?: 'auto' | 'good' | 'bad' | 'neutral';
  readonly goodTone?: 'normal' | 'inverted';
}

function biologicalRows(summary: OfflineSummary): readonly RowSpec[] {
  const b = summary.biological;
  const num = (d: OfflineSummaryDelta, fmt: (n: number) => string): RowSpec => ({
    label: '',
    before: fmt(d.before),
    after: fmt(d.after),
    deltaText: formatSignedDelta(d.delta),
    delta: d.delta,
  });
  const rows: RowSpec[] = [
    { ...num(b.height, (n) => `${n.toFixed(1)} m`), label: 'Height' },
    { ...num(b.trunkDiameter, (n) => `${n.toFixed(2)} m`), label: 'Trunk Diameter' },
    { ...num(b.currentLeaves, (n) => `${Math.round(n)}`), label: 'Current Leaves' },
    { ...num(b.energyReserves, (n) => formatPercent(n)), label: 'Energy Reserves' },
    { ...num(b.waterStored, (n) => formatPercent(n)), label: 'Water Stored' },
    { ...num(b.health, (n) => formatPercent(n)), label: 'Health' },
    { ...num(b.stress, (n) => formatPercent(n)), label: 'Stress', goodTone: 'inverted' },
  ];
  return rows;
}

function environmentalRows(summary: OfflineSummary): readonly RowSpec[] {
  const e = summary.environmental;
  const mk = (label: string, d: OfflineSummaryDelta, fmt: (n: number) => string, goodTone?: 'normal' | 'inverted'): RowSpec => ({
    label,
    before: fmt(d.before),
    after: fmt(d.after),
    deltaText: formatSignedDelta(d.delta),
    delta: d.delta,
    goodTone,
  });
  return [
    mk('Soil Water', e.soilWater, formatPercent),
    mk('Freshwater Availability', e.freshwaterAvailability, formatPercent),
    mk('Biodiversity Index', e.biodiversityIndex, formatPercent),
    mk('Forest Coverage', e.forestCoverage, formatPercent),
    // Temperature + CO2 rising is bad — invert the tone.
    mk('Global Temperature', e.globalTemperature, (n) => `${n.toFixed(2)}°C`, 'inverted'),
    mk('CO₂ Concentration', e.co2Concentration, (n) => `${Math.round(n)} ppm`, 'inverted'),
  ];
}

// ----------------------------------------------------------------------------
// Modal.
// ----------------------------------------------------------------------------

export interface OfflineModalProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the OfflineModal. Subscribes narrowly to `ui.pendingOfflineSummary`;
 * returns `null` when no summary is parked. The Continue click clears the
 * summary via the store's UI mutator (rule 6 — `simState` untouched).
 */
export function OfflineModal({ className }: OfflineModalProps = {}): ReactElement | null {
  const summary = useGameStore((s) => s.ui.pendingOfflineSummary);
  const clearPendingOfflineSummary = useGameStore((s) => s.clearPendingOfflineSummary);

  const onContinue = useCallback(() => {
    clearPendingOfflineSummary();
  }, [clearPendingOfflineSummary]);

  if (summary === null) return null;

  const bioRows = biologicalRows(summary);
  const envRows = environmentalRows(summary);
  const cashDelta = formatMoneyDelta(
    summary.economic.personalCash.before,
    summary.economic.personalCash.after,
  );
  const supplyDelta = formatMoneyDelta(
    summary.economic.monetarySupply.before,
    summary.economic.monetarySupply.after,
  );
  const issuedDelta = formatMoneyDelta(
    summary.economic.totalIssued.before,
    summary.economic.totalIssued.after,
  );
  const treeDied = summary.biological.alive.before && !summary.biological.alive.after;
  const simDays = simSecondsToDays(summary.simElapsedSeconds);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-modal-title"
      data-testid="offline-modal"
    >
      <div
        className={`max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-2xl ${className ?? ''}`}
      >
        {/* Header. */}
        <header className="mb-4 flex flex-col gap-1">
          <h2
            id="offline-modal-title"
            className="text-lg font-semibold text-slate-100"
            data-testid="offline-modal-title"
          >
            While You Were Away
          </h2>
          <p
            className="text-sm text-slate-400 tabular-nums"
            data-testid="offline-modal-range"
          >
            {formatDayRange(summary.fromDay, summary.toDay)}
          </p>
        </header>

        {/* Workload summary + capped warning. */}
        <section className="mb-4 rounded border border-slate-800 bg-slate-950/40 p-3" data-testid="offline-modal-workload">
          <p className="text-sm text-slate-300">
            Simulated <span className="font-semibold text-slate-100 tabular-nums">{simDays}</span> sim days in{' '}
            <span className="font-semibold text-slate-100 tabular-nums">{summary.chunksRun}</span> chunks.
          </p>
          {summary.capped ? (
            <p
              className="mt-2 text-xs text-amber-300"
              data-testid="offline-modal-capped-warning"
            >
              Your absence exceeded the 30-day cap; only the first 30 real days were simulated.
            </p>
          ) : null}
        </section>

        {/* Biological deltas. */}
        <section className="mb-4" data-testid="offline-modal-biological">
          <h3 className="mb-1 text-xs uppercase tracking-wider text-slate-500">Biological</h3>
          {treeDied ? (
            <p
              className="mb-2 text-sm font-semibold text-rose-300"
              data-testid="offline-modal-tree-died"
            >
              Your tree died while you were away.
            </p>
          ) : null}
          <ul className="divide-y divide-slate-800/60">
            {bioRows.map((r) => (
              <OfflineDeltaRow key={r.label} {...r} />
            ))}
          </ul>
        </section>

        {/* Economic deltas. */}
        <section className="mb-4" data-testid="offline-modal-economic">
          <h3 className="mb-1 text-xs uppercase tracking-wider text-slate-500">Economic</h3>
          <ul className="divide-y divide-slate-800/60">
            <OfflineDeltaRow
              label="Personal Cash"
              before={formatMoneyFromStr(summary.economic.personalCash.before)}
              after={formatMoneyFromStr(summary.economic.personalCash.after)}
              deltaText={cashDelta.text}
              delta={cashDelta.delta}
            />
            <OfflineDeltaRow
              label="Monetary Supply"
              before={formatMoneyFromStr(summary.economic.monetarySupply.before)}
              after={formatMoneyFromStr(summary.economic.monetarySupply.after)}
              deltaText={supplyDelta.text}
              delta={supplyDelta.delta}
            />
            <OfflineDeltaRow
              label="Inflation Index"
              before={summary.economic.inflationIndex.before.toFixed(2)}
              after={summary.economic.inflationIndex.after.toFixed(2)}
              deltaText={formatSignedDelta(summary.economic.inflationIndex.delta)}
              delta={summary.economic.inflationIndex.delta}
            />
            <OfflineDeltaRow
              label="Total Issued"
              before={formatMoneyFromStr(summary.economic.totalIssued.before)}
              after={formatMoneyFromStr(summary.economic.totalIssued.after)}
              deltaText={issuedDelta.text}
              delta={issuedDelta.delta}
            />
          </ul>
          <p
            className="mt-2 text-xs text-slate-500 tabular-nums"
            data-testid="offline-modal-transactions"
          >
            {summary.economic.transactionsCount.after - summary.economic.transactionsCount.before} transactions recorded.
          </p>
        </section>

        {/* Environmental deltas. */}
        <section className="mb-5" data-testid="offline-modal-environmental">
          <h3 className="mb-1 text-xs uppercase tracking-wider text-slate-500">Environmental</h3>
          <ul className="divide-y divide-slate-800/60">
            {envRows.map((r) => (
              <OfflineDeltaRow key={r.label} {...r} />
            ))}
          </ul>
        </section>

        {/* Dismiss. */}
        <footer className="flex justify-end">
          <Button
            tone="active"
            onClick={onContinue}
            data-testid="offline-modal-continue"
          >
            Continue
          </Button>
        </footer>
      </div>
    </div>
  );
}
