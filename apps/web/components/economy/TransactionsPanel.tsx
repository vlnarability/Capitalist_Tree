/**
 * TransactionsPanel — recent economy transactions (P5c — GDD §13.3).
 *
 * Subscribes narrowly to `simState.economy.transactions` (the engine's
 * transaction ledger). Renders the most recent transactions with:
 *
 *   - bigint amount formatted via `formatMoneyFromStr` (TDD §10.1 — money
 *     is stored as bigint minor units as string).
 *   - Category label via `describeTransactionCategory` (purchase / expense
 *     / issuance / sink / transfer).
 *   - Source → destination account ids.
 *   - Sim-day stamp derived from the `timestamp` field (seconds → Day N).
 *
 * GDD §13.3 ("An optional advanced interface exposes: Economic transactions")
 * calls out transactions as one of the advanced-view items. The panel
 * surfaces them with the one-line summary produced by
 * `describeTransaction` so the player reads a sentence, not a row of ids.
 *
 * Rule 6 (rendering / UI reads state, never writes): no dispatches, no
 * engine calls. Reads the transactions array and renders.
 *
 * Returns `null` until `simState` is published (loop hasn't booted).
 */
'use client';

import { useMemo, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { formatSignedMoney } from '../../lib/format/money';
import {
  describeTransaction,
  describeTransactionCategory,
} from '../../lib/format/describe';
import { PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID } from '@capitalist-tree/shared';
import type { TransactionRecord } from '@capitalist-tree/shared';

export interface TransactionsPanelProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
  /**
   * Maximum number of recent transactions to render. Defaults to 10 —
   * keeps the panel readable; the underlying ledger retains the full
   * history for the dev console.
   */
  readonly max?: number;
}

/**
 * Compute the signed amount display for a transaction row. The amount is
 * always positive in the schema (`z.string().min(1)` + transfer validates
 * > 0), but the *direction* relative to `player:personal` determines the
 * sign shown to the player:
 *
 *   - source = 'player:personal' → outflow → `-$X.XX`
 *   - destination = 'player:personal' → inflow → `+$X.XX`
 *   - neither (e.g. external→external or authority→market) → unsigned.
 *
 * Pure: takes the record + the player's account id, returns a string.
 */
function formatTransactionAmount(t: TransactionRecord): string {
  const minor = BigInt(t.amount || '0');
  if (
    t.sourceAccount === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID &&
    t.destinationAccount !== PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID
  ) {
    return formatSignedMoney(-minor);
  }
  if (
    t.destinationAccount === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID &&
    t.sourceAccount !== PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID
  ) {
    return formatSignedMoney(minor);
  }
  // External→external / authority flows — show unsigned.
  return formatSignedMoney(minor).replace(/^[+-]/, '');
}

/**
 * Tone for a transaction row's amount — emerald for inflows, amber for
 * outflows, slate for neutral flows. Mirrors the tone set the rest of the
 * dashboard uses so the panel feels consistent.
 */
function toneForTransaction(t: TransactionRecord): 'emerald' | 'amber' | 'slate' {
  if (
    t.sourceAccount === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID &&
    t.destinationAccount !== PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID
  ) {
    return 'amber';
  }
  if (
    t.destinationAccount === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID &&
    t.sourceAccount !== PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID
  ) {
    return 'emerald';
  }
  return 'slate';
}

const TEXT_TONE: Readonly<Record<'emerald' | 'amber' | 'slate', string>> = Object.freeze({
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  slate: 'text-slate-300',
});

/**
 * Render the TransactionsPanel. Subscribes narrowly to the transactions
 * array. Returns `null` when `simState` is null (loop hasn't booted).
 */
export function TransactionsPanel({
  className,
  max = 10,
}: TransactionsPanelProps = {}): ReactElement | null {
  const transactions = useGameStore(
    (s) => s.simState?.economy.transactions ?? null,
  );

  // Slice to the last `max` transactions. Memoised so the slice doesn't
  // re-allocate when an unrelated slice changes (the underlying array
  // reference is stable across unrelated commits).
  const recent = useMemo(() => {
    if (!transactions) return [];
    if (transactions.length <= max) return transactions;
    return transactions.slice(transactions.length - max);
  }, [transactions, max]);

  if (transactions === null) return null;

  // Show the most-recent-first ordering for readability.
  const ordered = [...recent].reverse();

  return (
    <div
      className={`flex flex-col gap-2 ${className ?? ''}`}
      data-testid="transactions-panel"
    >
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        Recent transactions ({ordered.length})
      </span>
      {ordered.length === 0 ? (
        <p
          className="text-xs text-slate-500"
          data-testid="transactions-empty"
        >
          No transactions yet — purchases, harvests, and expenses will appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="transactions-list">
          {ordered.map((t) => {
            const tone = toneForTransaction(t);
            const amountStr = formatTransactionAmount(t);
            const summary = describeTransaction(t);
            const category = describeTransactionCategory(t.category);
            return (
              <li
                key={t.id}
                className="flex flex-col gap-0.5 rounded border border-slate-800/60 bg-slate-900/40 p-2"
                data-testid={`transaction-${t.id}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-slate-400">{category}</span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${TEXT_TONE[tone]}`}
                    data-testid={`transaction-${t.id}-amount`}
                  >
                    {amountStr}
                  </span>
                </div>
                <span
                  className="text-[11px] text-slate-500"
                  data-testid={`transaction-${t.id}-summary`}
                >
                  {summary}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
