/**
 * Dashboard components barrel (P5b).
 *
 * Re-exports the dashboard summary components used by the main game screen
 * (apps/web/app/page.tsx). Each component:
 *
 *   - Subscribes narrowly to its own slice(s) of the Zustand store via
 *     `useGameStore(s => s.simState?.field)` so unrelated slice changes
 *     don't trigger re-renders (TDD §16 selective UI updates).
 *   - Returns `null` when `simState` is null (loop hasn't booted) so the
 *     page can render a loading placeholder.
 *   - Reads state only — never dispatches actions except SpeedControls
 *     (which dispatches `set-speed` / `pause` / `resume` through the store)
 *     and the page-level Save/Load/NewGame buttons (which call the
 *     `useSimulationLoop` hook's helpers). Rule 6 (rendering / UI reads
 *     state, never writes): the symmetric counterpart is "UI dispatches are
 *     the only path by which UI-initiated actions modify `simState`."
 */
export { MoneyDisplay, type MoneyDisplayProps } from './MoneyDisplay';
export {
  TreeConditionSummary,
  type TreeConditionSummaryProps,
  useTreeConditionTone,
} from './TreeConditionSummary';
export { ExpensesSummary, type ExpensesSummaryProps } from './ExpensesSummary';
export { ResourcesSummary, type ResourcesSummaryProps } from './ResourcesSummary';
export { WeatherDisplay, type WeatherDisplayProps } from './WeatherDisplay';
export { SpeedControls, type SpeedControlsProps } from './SpeedControls';
// P5c: advanced-view toggle — switches the dashboard between simplified
// (GDD §13.2) and advanced (GDD §13.3) presentation. The toggle itself
// lives in the dashboard barrel because it shares the Panel/Button
// primitives + is rendered at the top of the simulation panel.
export {
  AdvancedViewToggle,
  type AdvancedViewToggleProps,
} from './AdvancedViewToggle';
