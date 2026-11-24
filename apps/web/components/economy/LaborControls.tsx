/**
 * LaborControls — manual labor UI (P12-D / W54 — GDD §7.3 second income path).
 *
 * The `perform-labor` action is the income alternative to harvesting leaves:
 * instead of debiting foliage (which reduces photosynthetic capacity), the
 * player works for a wage ($5/hr) credited from the authority (issuance) to
 * `player:personal`. The cost is exhaustion (0.05/hr, max 1.0) + a health
 * penalty derived from the exhaustion delta. The PersonalSystem decays
 * exhaustion each tick (rest/recovery).
 *
 * This panel lets the player pick a shift length (1..12 hours) and dispatches
 * `performLabor(hours)`. It shows:
 *   - Wage preview ($X.XX for the selected hours).
 *   - Current → projected exhaustion (bar).
 *   - Health (gates whether the player can work — min 0.15).
 *   - Inline warnings when too unhealthy or too exhausted to work.
 *
 * The handler rejects gracefully (a `notification` event, no throw) when
 * health is too low or exhaustion would overflow — those events are NOT in
 * `ACTIONABLE_NOTIFICATION_CODES`, so this panel surfaces the same feedback
 * inline (mirrors HarvestControls' dead-tree warning pattern).
 *
 * Architecture:
 *   - Rule 6 (rendering / UI reads state, never writes): subscribes to
 *     player slices + dispatches through the store. The engine owns the
 *     wage/exhaustion mutation.
 *   - TDD §16 selective UI updates: narrow selectors per slice.
 *
 * Returns `null` until `simState` is published (loop hasn't booted).
 */
'use client';

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  PROVISIONAL_LABOR_EXHAUSTION_MAX,
  PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR,
  PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT,
  PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK,
  PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR,
} from '@capitalist-tree/shared';
import { useGameStore } from '../../stores/game-store';
import { performLabor } from '../../lib/actions';
import { formatMoneyFromStr } from '../../lib/format/money';
import { Button } from '../common/Button';

/** Default shift length when the panel first mounts (a full workday). */
const DEFAULT_HOURS = 8;

export interface LaborControlsProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the LaborControls. Subscribes narrowly to `player.health` +
 * `player.laborExhaustion` + `player.personalCash` slices + the store's
 * `dispatch`. Returns `null` when `simState` is null.
 */
export function LaborControls({
  className,
}: LaborControlsProps = {}): ReactElement | null {
  const health = useGameStore((s) => s.simState?.player.health ?? null);
  const exhaustion = useGameStore((s) => s.simState?.player.laborExhaustion ?? null);
  const personalCash = useGameStore((s) => s.simState?.player.personalCash ?? null);
  const dispatch = useGameStore((s) => s.dispatch);

  const [hoursInput, setHoursInput] = useState<string>(String(DEFAULT_HOURS));

  // Parse + clamp the input to [1, MAX]. Returns 0 for empty / invalid so
  // the Work button stays disabled until the player enters a valid number.
  const hours = useMemo(() => {
    const n = Number.parseInt(hoursInput, 10);
    if (!Number.isInteger(n) || n < 1) return 0;
    return Math.min(n, PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT);
  }, [hoursInput]);

  // Wage = hours × $5/hr, in bigint minor units (string for formatMoneyFromStr).
  const wageMinor = useMemo(
    () =>
      hours > 0
        ? String(BigInt(PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR) * BigInt(hours))
        : '0',
    [hours],
  );

  const exhaustionGain = hours * PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR;
  const exhaustionAfter = (exhaustion ?? 0) + exhaustionGain;
  const exhaustionProjected = Math.min(exhaustionAfter, PROVISIONAL_LABOR_EXHAUSTION_MAX);

  // Inline guards mirror the sim handler's graceful-rejection checks
  // (actions.ts:287 health guard + :306 exhaustion guard). The button is
  // disabled when either would reject, so the player gets immediate
  // feedback instead of a silent notification they'll never see (those
  // notification codes aren't in ACTIONABLE_NOTIFICATION_CODES).
  const tooUnhealthy = health !== null && health < PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK;
  const tooExhausted = exhaustionAfter > PROVISIONAL_LABOR_EXHAUSTION_MAX;
  const canWork = hours > 0 && !tooUnhealthy && !tooExhausted;

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setHoursInput(e.target.value);
  }, []);

  const onWork = useCallback(() => {
    if (!canWork) return;
    dispatch(performLabor(hours));
  }, [canWork, dispatch, hours]);

  if (health === null || exhaustion === null || personalCash === null) return null;

  const exhaustionPct = Math.round(exhaustion * 100);
  const exhaustionProjectedPct = Math.round(exhaustionProjected * 100);

  return (
    <div
      className={`flex flex-col gap-3 ${className ?? ''}`}
      data-testid="labor-controls"
    >
      <div
        className="rounded border border-brass/40 bg-brass/10 p-3"
        data-testid="labor-wage-preview"
      >
        <span className="text-[10px] uppercase tracking-wider text-ink-soft">
          Shift wage (GDD §7.3)
        </span>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-2xl font-bold tabular-nums text-brass-2" data-testid="labor-wage">
            {formatMoneyFromStr(wageMinor)}
          </span>
          <span className="text-xs text-ink-soft">
            {hours > 0 ? `${hours} hr · $5/hr` : '—'}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-2">
          Credited from the authority (issuance) to your personal cash.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="labor-hours"
          className="text-[10px] uppercase tracking-wider text-ink-soft"
        >
          Shift length (hours)
        </label>
        <input
          id="labor-hours"
          type="number"
          min={1}
          max={PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT}
          step={1}
          value={hoursInput}
          onChange={onInputChange}
          className="w-32 rounded border border-ink bg-parchment px-2 py-1 text-sm text-ink tabular-nums focus:border-brass focus:outline-none focus-visible:ring-2 focus-visible:ring-brass/50"
          data-testid="labor-input"
        />
        <p className="text-[11px] text-ink-soft">
          Max {PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT} hours per shift. Each hour
          adds {Math.round(PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR * 100)}%
          exhaustion.
        </p>
      </div>

      <div className="flex flex-col gap-1" data-testid="labor-exhaustion">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-ink-soft">
            Exhaustion
          </span>
          <span className="text-xs tabular-nums text-ink-2">
            {exhaustionPct}% → {exhaustionProjectedPct}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full bg-brass transition-[width] duration-200"
            style={{ width: `${exhaustionProjectedPct}%` }}
          />
        </div>
        <p className="text-[11px] text-ink-soft">
          Rest recovers exhaustion each tick
          ({Math.round(PROVISIONAL_LABOR_EXHAUSTION_MAX * 100)}% cap).
        </p>
      </div>

      <Button
        tone="active"
        icon="🛠"
        onClick={onWork}
        disabled={!canWork}
        data-testid="labor-button"
      >
        Work{hours > 0 ? ` ${hours} hour${hours === 1 ? '' : 's'}` : ''}
      </Button>

      {tooUnhealthy ? (
        <p className="text-xs text-accent/80" data-testid="labor-warning">
          Health too low to work
          (min {Math.round(PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK * 100)}%).
          Rest to recover.
        </p>
      ) : tooExhausted ? (
        <p className="text-xs text-accent/80" data-testid="labor-warning">
          Too exhausted for a {hours}-hour shift. Rest first or pick fewer
          hours.
        </p>
      ) : null}

      <p className="text-xs text-ink-soft" data-testid="labor-hint">
        Labor is the income alternative to harvesting: it pays wages without
        cutting foliage, but costs health + exhaustion (GDD §7.3).
      </p>
    </div>
  );
}
