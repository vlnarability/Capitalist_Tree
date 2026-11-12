/**
 * ExpensesSummary — personal living expenses (P5b — GDD §13.1, §7.1).
 *
 * Subscribes narrowly to `simState.player.livingExpenses` (five bigint-as-string
 * fields) + `simState.player.unpaidDays`. Sums the five categories via
 * `sumMinorStrings` and shows:
 *
 *   - The monthly (per billing cycle) total.
 *   - A breakdown by category so the player sees where their cash is going.
 *   - The unpaid-days counter (rose-tinted) when > 0 so the player knows
 *     they're falling behind on bills.
 *
 * Per GDD §13.2 (simplified view), the helper does NOT expose the underlying
 * `LivingExpenseCategory` enum or the expense model — it just shows the
 * total + a breakdown line + a warning. The reader doesn't need to know that
 * `food: '12000'` means $120.00/month; they just see `Food $120.00`.
 *
 * Rule 6 (rendering / UI reads state, never writes): no engine calls, no
 * dispatches. The engine owns the expense scheduling; this component renders.
 */
'use client';

import type { ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import {
  LIVING_EXPENSE_CATEGORIES,
  type LivingExpenseCategory,
} from '@capitalist-tree/shared';
import { formatMoneyFromStr, sumMinorStrings } from '../../lib/format/money';
import { Stat } from '../common/Stat';

export interface ExpensesSummaryProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

// Plain-language labels for the five categories — capitalised + readable.
const CATEGORY_LABELS: Readonly<Record<LivingExpenseCategory, string>> = Object.freeze({
  food: 'Food',
  housing: 'Housing',
  utilities: 'Utilities',
  healthcare: 'Healthcare',
  transportation: 'Transportation',
});

/**
 * Render the expenses summary. Subscribes narrowly to `player.livingExpenses`
 * (an object — Zustand's reference-equality check will re-render when the
 * store replaces it, which only happens when the engine updates the slice)
 * + `player.unpaidDays` (a primitive).
 *
 * Returns `null` when `simState` is null (loop hasn't booted).
 */
export function ExpensesSummary({ className }: ExpensesSummaryProps = {}): ReactElement | null {
  const livingExpenses = useGameStore((s) => s.simState?.player.livingExpenses ?? null);
  const unpaidDays = useGameStore((s) => s.simState?.player.unpaidDays ?? null);

  if (livingExpenses === null || unpaidDays === null) return null;

  const values = LIVING_EXPENSE_CATEGORIES.map((c) => livingExpenses[c]);
  const total = sumMinorStrings(values);
  const showUnpaidWarning = unpaidDays > 0;

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`} data-testid="expenses-summary">
      <Stat
        label="Monthly Expenses"
        value={formatMoneyFromStr(String(total))}
        tone={showUnpaidWarning ? 'rose' : 'slate'}
        sub={showUnpaidWarning ? `${unpaidDays} unpaid day${unpaidDays === 1 ? '' : 's'}` : 'Billed each cycle'}
      />

      <ul className="flex flex-col gap-1.5 text-sm" data-testid="expenses-breakdown">
        {LIVING_EXPENSE_CATEGORIES.map((c) => (
          <li
            key={c}
            className="flex items-baseline justify-between gap-2 tabular-nums"
          >
            <span className="text-slate-400">{CATEGORY_LABELS[c]}</span>
            <span className="text-slate-200">{formatMoneyFromStr(livingExpenses[c])}</span>
          </li>
        ))}
      </ul>

      {showUnpaidWarning ? (
        <p className="text-xs text-rose-400/80" data-testid="expenses-warning">
          ⚠ Unpaid bills are accumulating. Your physical health will start to suffer.
        </p>
      ) : null}
    </div>
  );
}
