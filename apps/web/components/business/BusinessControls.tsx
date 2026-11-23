/**
 * BusinessControls — P11-E (Phase 3 cont.): per-business management verbs.
 *
 * Renders the loan / employee / status controls for one owned business,
 * bridging the previously-unreachable take-loan / repay-loan / hire-employees /
 * lay-off-employees / set-business-status GameActions to the UI.
 *
 * Rendered as a collapsible "Manage" section under each owned-business row in
 * the BusinessesPanel. Reads `dispatch` + the business; never touches the
 * simulation directly (rule 6).
 */
import { useState, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import {
  takeLoan,
  repayLoan,
  hireEmployees,
  layOffEmployees,
  setBusinessStatus,
} from '../../lib/actions';
import { formatMoneyFromStr } from '../../lib/format/money';
import { Button } from '../common/Button';
import type { BusinessState } from '@capitalist-tree/shared';

/** Sim seconds in 30 real days (30 × 86400 × 60 factor) — default loan term. */
const DEFAULT_LOAN_TERM_SIM_SECONDS = 30 * 86400 * 60;
/** Default annualized interest rate (10%) for player-taken loans. */
const DEFAULT_LOAN_INTEREST_RATE = 0.1;

/** Convert a dollar string ("100" / "100.50") to minor-units string. */
function dollarsToMinor(dollars: string): string {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return BigInt(Math.round(n * 100)).toString();
}

export interface BusinessControlsProps {
  business: BusinessState;
}

export function BusinessControls({ business: b }: BusinessControlsProps): ReactElement {
  const dispatch = useGameStore((s) => s.dispatch);
  const simState = useGameStore((s) => s.simState);
  const [loanInput, setLoanInput] = useState('100');
  const [repayLiability, setRepayLiability] = useState('');
  const [repayAmount, setRepayAmount] = useState('50');
  const [open, setOpen] = useState(false);

  const nowTick = simState?.clock.elapsedSeconds ?? 0;
  const liabilities = b.liabilities;
  const canToggleStatus = b.status === 'operating' || b.status === 'idle';

  const onTakeLoan = () => {
    const principal = dollarsToMinor(loanInput);
    if (principal === '0') return;
    dispatch(
      takeLoan(b.id, principal, DEFAULT_LOAN_INTEREST_RATE, nowTick + DEFAULT_LOAN_TERM_SIM_SECONDS),
    );
  };
  const onRepay = () => {
    const amount = dollarsToMinor(repayAmount);
    if (amount === '0' || !repayLiability) return;
    dispatch(repayLoan(b.id, repayLiability, amount));
  };
  const onHire = () => dispatch(hireEmployees(b.id, 1));
  const onLayOff = () => {
    if (b.employees > 0) dispatch(layOffEmployees(b.id, 1));
  };
  const onToggleStatus = () => {
    if (!canToggleStatus) return;
    dispatch(setBusinessStatus(b.id, b.status === 'operating' ? 'idle' : 'operating'));
  };

  return (
    <div className="border-t border-ink/40 pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[0.65rem] uppercase tracking-wide text-ink-soft hover:text-ink"
        aria-expanded={open}
      >
        {open ? '▾ Manage' : '▸ Manage'}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-2">
          {/* Loan */}
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="text-[0.65rem] text-ink-soft">Loan $</label>
            <input
              type="number"
              min="1"
              step="1"
              value={loanInput}
              onChange={(e) => setLoanInput(e.target.value)}
              className="w-20 rounded border border-ink bg-parchment px-1.5 py-0.5 text-xs tabular-nums text-ink"
            />
            <Button onClick={onTakeLoan}>Take Loan</Button>
            <span className="text-[0.6rem] text-ink-2">@ {(DEFAULT_LOAN_INTEREST_RATE * 100).toFixed(0)}% / 30d</span>
          </div>

          {/* Repay (if liabilities exist) */}
          {liabilities.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="text-[0.65rem] text-ink-soft">Repay</label>
              <select
                value={repayLiability}
                onChange={(e) => setRepayLiability(e.target.value)}
                className="max-w-[8rem] rounded border border-ink bg-parchment px-1.5 py-0.5 text-xs text-ink"
              >
                <option value="">Select loan…</option>
                {liabilities.map((l) => (
                  <option key={l.id} value={l.id}>
                    {formatMoneyFromStr(l.principal)} @ {(l.interestRate * 100).toFixed(0)}%
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                step="1"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                className="w-16 rounded border border-ink bg-parchment px-1.5 py-0.5 text-xs tabular-nums text-ink"
              />
              <Button tone="warning" onClick={onRepay}>
                Repay
              </Button>
            </div>
          )}

          {/* Employees + status */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.65rem] text-ink-soft">Employees: {b.employees}</span>
            <Button onClick={onHire}>+ Hire</Button>
            <Button tone="warning" onClick={onLayOff} disabled={b.employees === 0}>
              − Lay Off
            </Button>
            {canToggleStatus && (
              <Button onClick={onToggleStatus}>
                {b.status === 'operating' ? 'Pause' : 'Resume'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
