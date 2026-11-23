/**
 * PolicyPanel — P11-E (Phase 6 game-loop gap): government + monetary policy.
 *
 * Bridges the previously-unreachable `set-government-policy` /
 * `set-monetary-policy` GameActions to the UI. Pre-P11-E the player had no
 * way to set environmental regulation stringency, carbon tax, the central-bank
 * interest rate, inflation target, or money-supply growth.
 *
 * Two sections:
 *   - **Government**: environmentalRegulations (0–1 slider) + carbonTaxRate
 *     (0–1 slider). Dispatches `set-government-policy` on release.
 *   - **Monetary**: interestRate + inflationTarget + moneySupplyGrowth (all
 *     annual fractions, number inputs). Dispatches `set-monetary-policy`.
 *
 * Advanced-view only (Phase 6 is sandbox/policy-leaning). Reads `simState` +
 * `dispatch` via narrow Zustand selectors; never touches the simulation
 * directly (rule 6).
 */
import { type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { setGovernmentPolicy, setMonetaryPolicy } from '../../lib/actions';

export interface PolicyPanelProps {
  className?: string;
}

/** Format a 0–1 fraction as a percentage string. */
function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

/** Format an annual fraction as a percentage with one decimal. */
function pct1(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function PolicyPanel({ className }: PolicyPanelProps = {}): ReactElement | null {
  const simState = useGameStore((s) => s.simState);
  const dispatch = useGameStore((s) => s.dispatch);

  if (!simState) return null;

  const nowTick = simState.clock.elapsedSeconds;
  const gov = simState.eventState.global.governmentPolicy;
  const mon = simState.eventState.global.monetaryPolicy;

  return (
    <section
      className={`rounded-lg border border-ink bg-parchment/60 p-4 ${className ?? ''}`}
      aria-labelledby="policy-panel-title"
    >
      <h2 id="policy-panel-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-2">
        Policy
      </h2>

      {/* Government */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-soft">Government</h3>
        <label className="mb-1 block text-xs text-ink-2">
          Environmental Regulations: <span className="tabular-nums text-ink">{pct(gov.environmentalRegulations)}</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={gov.environmentalRegulations}
          onChange={(e) =>
            dispatch(setGovernmentPolicy({ environmentalRegulations: Number(e.target.value) }, nowTick))
          }
          className="mb-3 w-full accent-emerald-500"
        />
        <label className="mb-1 block text-xs text-ink-2">
          Carbon Tax Rate: <span className="tabular-nums text-ink">{pct(gov.carbonTaxRate)}</span>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={gov.carbonTaxRate}
          onChange={(e) => dispatch(setGovernmentPolicy({ carbonTaxRate: Number(e.target.value) }, nowTick))}
          className="w-full accent-emerald-500"
        />
      </div>

      {/* Monetary */}
      <div className="border-t border-ink/60 pt-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-soft">Monetary</h3>
        <label className="mb-1 block text-xs text-ink-2">
          Interest Rate (annual): <span className="tabular-nums text-ink">{pct1(mon.interestRate)}</span>
        </label>
        <input
          type="range"
          min="0"
          max="0.3"
          step="0.005"
          value={mon.interestRate}
          onChange={(e) => dispatch(setMonetaryPolicy({ interestRate: Number(e.target.value) }, nowTick))}
          className="mb-3 w-full accent-sky-500"
        />
        <label className="mb-1 block text-xs text-ink-2">
          Inflation Target (annual): <span className="tabular-nums text-ink">{pct1(mon.inflationTarget)}</span>
        </label>
        <input
          type="range"
          min="0"
          max="0.1"
          step="0.005"
          value={mon.inflationTarget}
          onChange={(e) => dispatch(setMonetaryPolicy({ inflationTarget: Number(e.target.value) }, nowTick))}
          className="mb-3 w-full accent-sky-500"
        />
        <label className="mb-1 block text-xs text-ink-2">
          Money Supply Growth (annual): <span className="tabular-nums text-ink">{pct1(mon.moneySupplyGrowth)}</span>
        </label>
        <input
          type="range"
          min="0"
          max="0.1"
          step="0.005"
          value={mon.moneySupplyGrowth}
          onChange={(e) => dispatch(setMonetaryPolicy({ moneySupplyGrowth: Number(e.target.value) }, nowTick))}
          className="w-full accent-sky-500"
        />
      </div>
    </section>
  );
}
