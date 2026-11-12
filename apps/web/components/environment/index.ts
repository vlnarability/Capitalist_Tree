/**
 * Environment components barrel (P5c).
 *
 * Re-exports the advanced-view panels for the environmental side of the
 * simulation:
 *   - BiologyPanel — GDD §13.3 biology formulas + energy allocation +
 *     stress factors + derived health explanation.
 *   - EnvironmentPanel — GDD §13.3 environmental data (soil N/P/K, water
 *     balance, weather, pollution, CO2, biodiversity).
 *
 * Each panel subscribes narrowly to its own slices of the Zustand store
 * via `useGameStore(s => s.simState?.field)` so unrelated slice changes
 * don't trigger re-renders (TDD §16 selective UI updates). Returns
 * `null` when `simState` is null (loop hasn't booted) so the page can
 * render a loading placeholder. Reads state only — no dispatches (rule 6).
 */
export { BiologyPanel, type BiologyPanelProps } from './BiologyPanel';
export { EnvironmentPanel, type EnvironmentPanelProps } from './EnvironmentPanel';
