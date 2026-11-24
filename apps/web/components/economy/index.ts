/**
 * Economy components barrel (P5c).
 *
 * Re-exports the advanced-view economy panels + controls:
 *   - TransactionsPanel — recent transactions ledger view.
 *   - HarvestControls — manual harvest UI with sustainable-harvest indicator.
 *   - PurchaseControls — buy water/fertilizer from markets + apply to tree.
 *   - TradePanel — international trade (import/export at the foreign world
 *     price + tariff) — P13-B / GAP-24.
 *   - CurrencyCosmeticPicker — select one of P4's three currency cosmetics.
 *
 * Each component subscribes narrowly to its own slices of the Zustand
 * store. Controls dispatch through `store.dispatch` + `lib/actions`
 * factories — the only path by which UI-initiated actions modify
 * `simState` (rule 6 + TDD §16).
 */
export {
  TransactionsPanel,
  type TransactionsPanelProps,
} from './TransactionsPanel';
export { HarvestControls, type HarvestControlsProps } from './HarvestControls';
export { LaborControls, type LaborControlsProps } from './LaborControls';
export { SeedControls, type SeedControlsProps } from './SeedControls';
export { PurchaseControls, type PurchaseControlsProps } from './PurchaseControls';
export { TradePanel, type TradePanelProps } from './TradePanel';
export {
  CurrencyCosmeticPicker,
  type CurrencyCosmeticPickerProps,
} from './CurrencyCosmeticPicker';
