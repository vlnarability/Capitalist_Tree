/**
 * MoneyDisplay — current money summary (P5b — GDD §13.1 main screen).
 *
 * Subscribes to the player's `personalCash` (bigint-as-string minor units) via
 * a narrow Zustand selector: `useGameStore(s => s.simState?.player.personalCash ?? null)`.
 * Because the selector returns a primitive string, React only re-renders this
 * component when the actual value changes — not on every simulation step
 * (TDD §16: "selective UI updates", "avoid forcing a full React re-render
 * for every biological simulation step").
 *
 * Shows:
 *   - The formatted current cash as `$X.XX` via `formatMoneyFromStr`.
 *   - The inflation-adjusted purchasing power (`$X.XX` ÷ inflation index) so
 *     the player sees both nominal and real value — important once the
 *     EconomySystem starts inflating prices (P3b).
 *
 * Rule 6 (rendering / UI reads state, never writes): the component reads
 * `simState.player.personalCash` and renders a string. It never dispatches
 * an action; the engine owns the cash balance.
 *
 * Returns `null` until `simState` is published (the loop hasn't booted) so
 * the parent can render a loading placeholder.
 */
'use client';

import type { ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { formatMoneyFromStr } from '../../lib/format/money';

/**
 * Format the inflation-adjusted purchasing power of `personalCashStr`.
 *
 * `realCash = personalCash / inflationIndex` (clamped to 0). The index is
 * `1.0` at game start and rises when prices rise (P3b EconomySystem). Showing
 * both nominal and real values lets the player see whether their growing
 * balance actually buys more (GDD §6.3 — purchasing power).
 *
 * Defensive: returns the nominal value when `inflationIndex` is missing /
 * non-finite / <= 0 so a transient bad value never takes down the dashboard.
 */
function formatRealCash(personalCashStr: string, inflationIndex: number | undefined): string {
  if (!Number.isFinite(inflationIndex ?? 0) || (inflationIndex ?? 1) <= 0) {
    return formatMoneyFromStr(personalCashStr);
  }
  const nominal = Number(BigInt(personalCashStr || '0'));
  const realMinor = Math.round(nominal / (inflationIndex as number));
  // Round back to a bigint string and reformat via formatMoneyFromStr so
  // grouping + symbol handling stay consistent with the nominal line.
  return formatMoneyFromStr(String(realMinor));
}

export interface MoneyDisplayProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the current money summary. Subscribes narrowly to
 * `simState.player.personalCash` + `simState.economy.inflationIndex` so
 * unrelated slice changes don't re-render this component.
 *
 * Returns `null` when `simState` is null (the simulation loop hasn't booted
 * yet) so the page can render a loading placeholder.
 */
export function MoneyDisplay({ className }: MoneyDisplayProps = {}): ReactElement | null {
  // Narrow selectors: each returns a primitive so Zustand skips re-render
  // when the primitive value is unchanged. This is the key to TDD §16's
  // "selective UI updates" — a player:cash change does NOT re-render
  // WeatherDisplay, ExpensesSummary, etc.
  const personalCash = useGameStore((s) => s.simState?.player.personalCash ?? null);
  const inflationIndex = useGameStore((s) => s.simState?.economy.inflationIndex ?? null);

  if (personalCash === null) return null;

  const nominal = formatMoneyFromStr(personalCash);
  const real = formatRealCash(personalCash, inflationIndex ?? undefined);
  const showReal = real !== nominal;

  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ''}`}>
      <span className="text-[10px] uppercase tracking-wider text-slate-500">Current Cash</span>
      <span className="text-3xl font-bold tabular-nums text-emerald-300" data-testid="money-nominal">
        {nominal}
      </span>
      {showReal ? (
        <span className="text-xs text-slate-500" data-testid="money-real">
          ≈ {real} purchasing power
        </span>
      ) : null}
    </div>
  );
}
