/**
 * SpeedControls — pause + speed-multiplier selector (P5b — GDD §13.1).
 *
 * Subscribes narrowly to `simState.clock.speedMultiplier` (a primitive number)
 * + `simState.clock.paused` (a primitive boolean). Reacts only when one of
 * those primitives changes — the rest of the simulation can re-render
 * freely without touching this panel (TDD §16 selective UI updates).
 *
 * Renders a Pause/Resume button + a row of speed-multiplier buttons (1x /
 * 5x / 15x / 60x). The selected multiplier is highlighted with the
 * `'active'` Button tone. Pause is wired via `pause()` / `resume()` factories
 * from `lib/actions.ts`; the multipliers via `setSpeed(m)` (which the engine
 * validates against `PROVISIONAL_SPEED_MULTIPLIERS`).
 *
 * Also shows the accumulator remainder (sim seconds not yet consumed by a
 * step) so the player has a coarse visual cue that the simulation is moving
 * — at 1x speed the accumulator sits close to 0 most of the time; at 60x it
 * often carries a visible remainder between frames. The accumulator value
 * is exposed by the `useSimulationLoop` hook (P5a) and passed as a prop by
 * the page.
 *
 * Rule 6 (rendering / UI reads state, never writes): the component reads
 * clock slices + dispatches actions through the store. Dispatch is the only
 * path by which UI-initiated actions modify `simState` (rule 6's symmetric
 * counterpart: UI mutators target the `ui` slice; engine mutators route
 * through `dispatch`).
 */
'use client';

import { useCallback, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { pause, resume, setSpeed } from '../../lib/actions';
import { Button } from '../common/Button';
import {
  PROVISIONAL_SPEED_MULTIPLIERS,
  PROVISIONAL_SPEED_PAUSED,
} from '@capitalist-tree/shared';

export interface SpeedControlsProps {
  /**
   * Optional accumulator remainder (sim seconds not yet consumed by a step).
   * The page passes `useSimulationLoop`'s `accumulator` field. The control
   * shows it as a coarse visual cue; defaults to 0 if not provided.
   */
  readonly accumulator?: number;
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * The non-paused speed multipliers exposed as buttons. The `0` (paused) entry
 * is excluded because pause has its own dedicated button — clicking the
 * Pause button calls `pause()` instead of `setSpeed(0)` (both work; the
 * dedicated button is clearer UX).
 */
const SPEED_BUTTONS: readonly number[] = PROVISIONAL_SPEED_MULTIPLIERS.filter(
  (m) => m !== PROVISIONAL_SPEED_PAUSED,
);

/**
 * Render the speed controls. Subscribes narrowly to the two clock primitives
 * + dispatches actions through the store.
 *
 * Returns `null` when `simState` is null (loop hasn't booted).
 */
export function SpeedControls({
  accumulator = 0,
  className,
}: SpeedControlsProps = {}): ReactElement | null {
  const speedMultiplier = useGameStore((s) => s.simState?.clock.speedMultiplier ?? null);
  const clockPaused = useGameStore((s) => s.simState?.clock.paused ?? null);

  // Dispatch actions through the store. `useGameStore.getState().dispatch`
  // is the canonical path — calling the action factory inline + dispatching
  // here keeps the click handler testable (the test asserts the store's
  // state changed, not the rendered button — see SpeedControls.test.tsx).
  const dispatch = useGameStore((s) => s.dispatch);

  // The "is paused" condition follows the simulation loop's own definition
  // (useSimulationLoop.ts): a clock with `speedMultiplier === 0` OR `paused`
  // === true` is considered paused. `pause()` sets `speedMultiplier = 0`
  // (does NOT touch `clock.paused`), so the multiplier is the authoritative
  // signal here. `clock.paused` is included defensively so a future UI that
  // toggles `paused` directly (without going through `set-speed=0`) still
  // reads as paused.
  const isPaused = clockPaused === null ? null : clockPaused || speedMultiplier === 0;

  const onPauseToggle = useCallback(() => {
    if (isPaused) {
      // Resume at the last non-zero multiplier (default to 1x if the player
      // paused before selecting a speed).
      const next = speedMultiplier && speedMultiplier > 0 ? speedMultiplier : 1;
      dispatch(resume(next));
    } else {
      dispatch(pause());
    }
  }, [dispatch, isPaused, speedMultiplier]);

  const onSetSpeed = useCallback(
    (m: number) => {
      dispatch(setSpeed(m));
    },
    [dispatch],
  );

  if (speedMultiplier === null || isPaused === null) return null;

  // The active button is the one matching the current speedMultiplier when
  // not paused. When paused, no speed button is highlighted.
  const activeSpeed = isPaused ? null : speedMultiplier;

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`} data-testid="speed-controls">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone={isPaused ? 'warning' : 'default'}
          icon={isPaused ? '▶' : '⏸'}
          onClick={onPauseToggle}
          data-testid="speed-controls-toggle"
        >
          {isPaused ? 'Resume' : 'Pause'}
        </Button>
        {SPEED_BUTTONS.map((m) => (
          <Button
            key={m}
            tone={activeSpeed === m ? 'active' : 'default'}
            onClick={() => onSetSpeed(m)}
            data-testid={`speed-controls-${m}x`}
          >
            {m}x
          </Button>
        ))}
      </div>
      <p className="text-xs text-slate-500" data-testid="speed-controls-accumulator">
        Accumulator: {Number.isFinite(accumulator) ? accumulator.toFixed(2) : '0.00'} sim seconds
      </p>
    </div>
  );
}
