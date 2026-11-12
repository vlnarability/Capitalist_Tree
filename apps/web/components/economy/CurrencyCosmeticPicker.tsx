/**
 * CurrencyCosmeticPicker — select one of P4's currency cosmetics (P5c —
 * GDD §6.1, §14, TDD §15.4).
 *
 * GDD §6.1: "The player can select the visual appearance and denomination
 * style of their currency." TDD §15.4: "Currency cosmetics MUST NOT modify
 * the underlying monetary value or simulation balance."
 *
 * This panel renders a row of buttons for each of the three CurrencyVisuals
 * shipped by P4a (leaf-banknote, gold-leaf, euro-leaf). Clicking a button
 * dispatches `setCurrencyCosmetic` (a UI-only action) via the store — the
 * mutator sets `ui.selectedCurrencyId` and leaves `simState` referentially
 * unchanged (rule 6: cosmetics stay out of the sim).
 *
 * The selected id is read back via `ui.selectedCurrencyId` — the TreeView
 * wrapper (P4d) re-applies the cosmetic via `renderer.setCurrency(...)`
 * when the id changes. The cosmetic is purely visual; the bigint balances
 * in `simState.economy` are never touched.
 *
 * Architecture:
 *
 *   - Rule 6 (rendering / UI reads state, never writes): reads
 *     `ui.selectedCurrencyId` + dispatches `setCurrencyCosmetic` (UI-only
 *     action — symmetric counterpart to `dispatch` for `UiAction`). Never
 *     touches `simState`.
 *   - Rule 2 (purity): `setCurrencyCosmetic` is a pure factory — it
 *     validates the currencyId + returns a plain action object.
 *   - TDD §16 selective UI updates: subscribes narrowly to
 *     `ui.selectedCurrencyId` (primitive) + `setCurrencyCosmetic` mutator
 *     reference (stable). Unrelated sim commits don't re-render.
 *
 * Always renders — `ui.selectedCurrencyId` is a UI-only field with a
 * default value, so the picker is interactive even before the loop boots.
 */
'use client';

import { useCallback, type ReactElement } from 'react';
import { ALL_CURRENCY_VISUALS, type CurrencyVisual } from '@capitalist-tree/rendering';
import { useGameStore } from '../../stores/game-store';

export interface CurrencyCosmeticPickerProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the currency cosmetic picker. One button per CurrencyVisual;
 * the active one is highlighted with the `'active'` Button tone.
 */
export function CurrencyCosmeticPicker({
  className,
}: CurrencyCosmeticPickerProps = {}): ReactElement {
  const selectedId = useGameStore((s) => s.ui.selectedCurrencyId);
  const setCurrency = useGameStore((s) => s.setCurrencyCosmetic);

  const onSelect = useCallback(
    (id: string) => {
      setCurrency(id);
    },
    [setCurrency],
  );

  return (
    <div
      className={`flex flex-col gap-2 ${className ?? ''}`}
      data-testid="currency-cosmetic-picker"
    >
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        Currency appearance (GDD §6.1 / §14)
      </span>
      <p className="text-xs text-slate-500">
        Cosmetic only — does not change the underlying monetary value
        (TDD §15.4).
      </p>
      <ul className="flex flex-col gap-2">
        {ALL_CURRENCY_VISUALS.map((visual: CurrencyVisual) => {
          const isSelected = visual.id === selectedId;
          return (
            <li key={visual.id}>
              <button
                type="button"
                onClick={() => onSelect(visual.id)}
                aria-pressed={isSelected}
                data-testid={`currency-cosmetic-${visual.id}`}
                className={[
                  'flex w-full items-center justify-between gap-2 rounded border px-3 py-2 text-left transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50',
                  isSelected
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800',
                ].join(' ')}
              >
                <div className="flex flex-col">
                  <span
                    className={`text-sm font-medium ${
                      isSelected ? 'text-emerald-200' : 'text-slate-200'
                    }`}
                  >
                    {visual.name}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {visual.banknoteTheme} · {visual.leafAppearance}
                  </span>
                </div>
                <span className="text-2xl font-bold tabular-nums text-slate-100">
                  {visual.symbol}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-slate-500" data-testid="currency-cosmetic-selected">
        Selected: <span className="text-slate-300">{selectedId}</span>
      </p>
    </div>
  );
}
