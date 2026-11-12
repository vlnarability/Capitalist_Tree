/**
 * Automation components barrel (P6d1 — TDD §12, GDD §9).
 *
 * Re-exports the automation panel + its presentational sub-components:
 *   - AutomationPanel — equipment shop + active automations + policy
 *     configurator. The advanced-view entry point.
 *   - EquipmentCard — presentational shop item.
 *   - ActiveAutomationRow — presentational row for an active automation.
 *   - PolicyConfigurator — sub-form for editing a policy.
 *
 * Each component subscribes narrowly to its own slices of the Zustand store
 * (or is purely presentational). Controls dispatch through `store.dispatch` +
 * `lib/actions` factories — the only path by which UI-initiated actions
 * modify `simState` (rule 6 + TDD §16). The UI never executes automation
 * directly (TDD §12) — it only reads state and dispatches actions.
 */
export { AutomationPanel, type AutomationPanelProps } from './AutomationPanel';
export { EquipmentCard, type EquipmentCardProps } from './EquipmentCard';
export {
  ActiveAutomationRow,
  type ActiveAutomationRowProps,
} from './ActiveAutomationRow';
export {
  PolicyConfigurator,
  type PolicyConfiguratorProps,
} from './PolicyConfigurator';
