/**
 * Offline components barrel (P6d2 — TDD §14.4, GDD §4.2).
 *
 * Re-exports the "while you were away" modal + its presentational sub-component:
 *   - OfflineModal — renders an `OfflineSummary` parked on the UI slice by
 *     the catch-up-on-load trigger (`lib/persistence/offline-catch-up-trigger.ts`).
 *     Dismiss (Continue) clears the summary.
 *   - OfflineDeltaRow — presentational before → after + delta-badge row.
 *
 * The modal reads `ui.pendingOfflineSummary` via a narrow Zustand selector and
 * clears it via `clearPendingOfflineSummary` (a UI mutator — `simState` is
 * referentially untouched; rule 6). The modal NEVER runs simulation logic —
 * the catch-up ran at load; the modal only displays the report.
 */
export { OfflineModal, type OfflineModalProps } from './OfflineModal';
export { OfflineDeltaRow, type OfflineDeltaRowProps } from './OfflineDeltaRow';
