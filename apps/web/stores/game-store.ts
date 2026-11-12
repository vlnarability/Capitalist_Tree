'use client';

/**
 * Game store (P5a — TDD §16 State Management, GDD §13 UI).
 *
 * Splits **simulation state** (read-only snapshots produced by the engine —
 * NEVER mutated by UI actions) from **UI state** (panels, advanced mode,
 * selection, notifications, currency cosmetic). The split is enforced by
 * the store's API surface: UI mutators (`setAdvancedView`,
 * `pushNotification`, `setCurrencyCosmetic`, ...) replace the `ui` slice
 * with a new object and leave `simState` referentially unchanged, while
 * simulation mutators (`dispatch`, `commitSimState`) replace `simState` with
 * the engine's fresh output.
 *
 * Public surface consumed by P5b/P5c/P5d:
 *
 *   - **Reactive fields** (subscribe via `useGameStore(s => s.<field>)`):
 *       - `simState: GameState | null` — latest engine snapshot; null until
 *         the loop boots.
 *       - `events: readonly SimulationEvent[]` — bounded recent-event log.
 *       - `engineStatus: 'idle' | 'booting' | 'running'` — boot lifecycle.
 *       - `ui: GameUiState` — UI slice (advancedView, selectedTab,
 *         notifications, selectedCurrencyId).
 *
 *   - **Selectors** (pure helpers; safe to inline or use directly):
 *       - `selectClock`, `selectPlayer`, `selectOriginalTree`, `selectEconomy`
 *         — read primitive sub-slices of `simState`. Returning a sub-slice
 *         from a selector avoids re-rendering components subscribed to OTHER
 *         slices when this slice changes (TDD §16: "selective UI updates").
 *
 *   - **Simulation mutators** (route through the engine — replace simState):
 *       - `dispatch(action: GameAction): readonly SimulationEvent[]` —
 *         routes through `engine.executeAction(state, action)` (TDD §4.1).
 *         Returns the emitted events; UI code can ignore them (they're
 *         already appended to the `events` log) or use them for inline
 *         feedback (e.g. a "purchase failed" toast).
 *       - `commitSimState(state, events?)` — used by the simulation-loop
 *         hook after `engine.advance(...)`. NOT for UI code (UI dispatches
 *         actions, the engine decides what changes).
 *
 *   - **UI mutators** (NEVER mutate simState):
 *       - `setAdvancedView(enabled)`, `setSelectedTab(tab)`,
 *         `setCurrencyCosmetic(currencyId)`, `pushNotification(n)`,
 *         `dismissNotification(id)`, `clearNotifications()`.
 *       - `setEngineStatus(status)` — used by the loop hook to publish boot
 *         progress.
 *
 *   - **UI-only actions**: handled via `applyUiAction` (the symmetric
 *     counterpart to `dispatch` for the `UiAction` union from
 *     `lib/actions.ts`). Currently only `set-currency-cosmetic`. UI mutators
 *     are also exposed individually for ergonomic call sites; `applyUiAction`
 *     is the typed-dispatch path for components that want to send a UIAction
 *     object (e.g. keyboard shortcuts, command palette).
 *
 * Why Zustand (TDD §16: "Zustand or a comparable state manager can coordinate
 * the application interface")?
 *   - Selective subscriptions: `useGameStore(s => s.ui.advancedView)` only
 *     re-renders the consumer when that boolean flips — no per-step re-render
 *     of the entire tree. TDD §16: "Avoid forcing a full React re-render for
 *     every biological simulation step."
 *   - `getState()` lets the simulation loop read + write without subscribing
 *     (the rAF closure is NOT a React component; it should never trigger a
 *     subscription).
 *   - `subscribe()` lets the loop hook react to `clock.paused` changes —
 *     cancelling + restarting its rAF.
 *
 * Purity contract (rule 2 — TDD §4.1):
 *   - `dispatch` calls `engine.executeAction`, which deep-copies the input
 *     state and returns a fresh reference. The store replaces `simState`
 *     with that fresh reference; the previous reference is never mutated.
 *   - UI mutators spread the `ui` slice to produce a new object — same
 *     contract.
 *
 * Cardinal rule (rule 6 — TDD §15.1, GDD §6.1): rendering / UI reads state,
 * NEVER writes. This store is the ONLY place UI code can request state
 * changes, and every UI mutator targets the `ui` slice — never `simState`.
 * `simState` is mutated exclusively by the engine (via `dispatch` /
 * `commitSimState`).
 */
import { create } from 'zustand';
import { engine } from '@capitalist-tree/simulation';
import type {
  GameAction,
  GameState,
  OfflineSummary,
  SimulationEvent,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_UI_DEFAULT_CURRENCY_VISUAL_ID,
  PROVISIONAL_UI_DEFAULT_TAB,
  PROVISIONAL_UI_MAX_EVENT_LOG,
  PROVISIONAL_UI_MAX_NOTIFICATIONS,
} from '../lib/constants';
import type { UiAction } from '../lib/actions';

// ----------------------------------------------------------------------------
// Public types.
// ----------------------------------------------------------------------------

/** Loop lifecycle. `null` simState corresponds to `'idle' | 'booting'`. */
export type EngineStatus = 'idle' | 'booting' | 'running';

/**
 * UI-side notification (GDD §13.5). Mirrors the engine's `notification`
 * SimulationEvent payload, but carries a client-generated `id` so the
 * notifications panel can dismiss individual entries. Stored in the `ui`
 * slice (NOT in `simState`) — UI-only.
 */
export interface UiNotification {
  readonly id: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly message: string;
  readonly code: string;
  /** Simulation seconds at which the notification was raised. */
  readonly at: number;
  /** Wall-clock ms when the UI created this entry. Used for "auto-dismiss after N seconds". */
  readonly createdAtMs: number;
}

/**
 * UI slice (TDD §16: "Interface-specific information such as: selected menu,
 * open panels, advanced mode, display preferences, selected tree, tooltip
 * visibility"). Everything here is presentation / UX state — never read by
 * the engine, never persisted to a save (only the `ui.selectedCurrencyId`
 * could be persisted as a display preference; P5a leaves that to P5b).
 *
 * P5d additions:
 *   - `reducedMotionOverride` — `'auto' | 'on' | 'off'`. The UI's
 *     `useReducedMotion` hook reads this together with the browser's
 *     `prefers-reduced-motion` media query to decide whether to disable
 *     non-essential UI animations (WCAG 2.1 AA / 2.3.3 Animation from
 *     Interactions — GDD §13 doesn't yet have a dedicated accessibility
 *     section; docs/ui.md §"Accessibility decisions" notes the gap +
 *     the WCAG criteria this satisfies).
 *     - `'auto'` (default): follow the OS preference via `matchMedia`.
 *     - `'on'`: force motion-reduced regardless of the OS setting.
 *     - `'off'`: force motion-enabled regardless of the OS setting
 *       (use sparingly — should respect explicit user override only).
 *
 *     P4's `TreeView` does NOT yet consume the hook (its rAF loop animates
 *     branch-sway + particles unconditionally). Documented as a gap in
 *     docs/ui.md §"Accessibility decisions" + R-P5d-2.
 */
export interface GameUiState {
  /** GDD §13.3: advanced interface toggle. False = simplified view. */
  readonly advancedView: boolean;
  /** GDD §13.1: currently-selected top-level tab. */
  readonly selectedTab: string;
  /** GDD §13.5: bounded notifications ring buffer (FIFO). */
  readonly notifications: readonly UiNotification[];
  /**
   * GDD §14 / TDD §15.4: selected currency cosmetic id. Resolved by the
   * rendering package via `findCurrencyVisual(id)`. Cosmetic only — does
   * NOT modify the underlying monetary value.
   */
  readonly selectedCurrencyId: string;
  /**
   * P5d — WCAG 2.1 AA / 2.3.3: in-game reduced-motion override.
   * `'auto'` (default) follows the OS `prefers-reduced-motion` media query;
   * `'on'` / `'off'` force the value regardless of the OS setting. Consumed
   * by `useReducedMotion()`; P4's TreeView is not yet wired (R-P5d-2).
   */
  readonly reducedMotionOverride: 'auto' | 'on' | 'off';
  /**
   * P6d2 — the "while you were away" summary parked by the catch-up-on-load
   * trigger (`lib/persistence/offline-catch-up-trigger.ts`) when a stale save
   * is loaded and `runOfflineCatchUp` produced a non-zero-chunk summary. The
   * OfflineModal renders this; the player's Continue click clears it via
   * `clearPendingOfflineSummary`. `null` when no modal is shown.
   *
   * UI-only — NOT part of the saved GameState (the summary is a transient
   * report derived at load time; re-deriving it on the next load is cheap
   * and avoids persisting a potentially stale snapshot). Rule 6: this lives
   * on the `ui` slice, so parking / clearing it never touches `simState`'s
   * reference.
   */
  readonly pendingOfflineSummary: OfflineSummary | null;
}

/**
 * Full Zustand store state. UI code subscribes to slices via selectors
 * (e.g. `useGameStore(s => s.ui.advancedView)`); the simulation-loop hook
 * reads + writes via `useGameStore.getState()`.
 */
export interface GameStoreState {
  // --- Reactive fields ---
  /** Latest engine snapshot. `null` until the loop boots. */
  readonly simState: GameState | null;
  /** Bounded recent-event log (last `PROVISIONAL_UI_MAX_EVENT_LOG` events). */
  readonly events: readonly SimulationEvent[];
  /** Loop lifecycle. */
  readonly engineStatus: EngineStatus;
  /** UI slice. UI mutators replace this reference; simState is untouched. */
  readonly ui: GameUiState;

  // --- Simulation mutators (replace simState via the engine) ---
  dispatch: (action: GameAction) => readonly SimulationEvent[];
  commitSimState: (state: GameState, events?: readonly SimulationEvent[]) => void;
  setEngineStatus: (status: EngineStatus) => void;

  // --- UI mutators (replace the `ui` slice; simState reference is unchanged) ---
  setAdvancedView: (enabled: boolean) => void;
  setSelectedTab: (tab: string) => void;
  setCurrencyCosmetic: (currencyId: string) => void;
  /**
   * P5d — set the in-game reduced-motion override. `'auto'` follows the OS
   * `prefers-reduced-motion` setting; `'on'` / `'off'` force the value.
   */
  setReducedMotionOverride: (mode: 'auto' | 'on' | 'off') => void;
  pushNotification: (n: Omit<UiNotification, 'id' | 'createdAtMs'>) => UiNotification;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  /**
   * P6d2 — park an `OfflineSummary` produced by the catch-up-on-load trigger
   * so the OfflineModal can render it. UI mutator only — `simState` is
   * referentially unchanged (rule 6).
   */
  setPendingOfflineSummary: (summary: OfflineSummary) => void;
  /**
   * P6d2 — clear the parked offline summary (the OfflineModal's Continue
   * click). UI mutator only.
   */
  clearPendingOfflineSummary: () => void;

  // --- UI-only action dispatch (symmetric to `dispatch` for `UiAction`) ---
  applyUiAction: (action: UiAction) => void;
}

// ----------------------------------------------------------------------------
// Internal helpers (pure).
// ----------------------------------------------------------------------------

/**
 * Append `next` to `prev`, capping at `max` entries (FIFO). Pure — returns
 * a new array if `next` is non-empty, otherwise returns `prev` unchanged
 * (so Zustand's reference-equality check skips the re-render).
 */
function appendBounded<T>(
  prev: readonly T[],
  next: readonly T[],
  max: number,
): readonly T[] {
  if (next.length === 0) return prev;
  const combined = [...prev, ...next];
  if (combined.length <= max) return combined;
  return combined.slice(combined.length - max);
}

/**
 * Monotonic counter for UI notification ids + a fallback for environments
 * without `crypto.randomUUID`. P5a uses a simple incrementing counter — ids
 * only need to be unique within a session (they're not persisted).
 */
let _notificationCounter = 0;
function nextNotificationId(): string {
  _notificationCounter += 1;
  return `ui-notif-${_notificationCounter}`;
}

// ----------------------------------------------------------------------------
// Selectors (pure helpers — exported for ergonomic subscriptions).
//
// Usage:
//   const clock = useGameStore(selectClock);
//   const elapsed = useGameStore(s => s.simState?.clock.elapsedSeconds ?? 0);
//
// Returning a sub-slice from a selector means React only re-renders the
// consumer when that specific sub-slice's reference changes — so a panel
// subscribed to `selectPlayer` does NOT re-render when `economy` updates.
// For primitive fields, use the inline `s => s.simState?.clock.elapsedSeconds`
// form so React skips re-renders when the primitive value is unchanged.
// ----------------------------------------------------------------------------

export function selectClock(state: GameStoreState): GameState['clock'] | null {
  return state.simState?.clock ?? null;
}
export function selectPlayer(state: GameStoreState): GameState['player'] | null {
  return state.simState?.player ?? null;
}
export function selectOriginalTree(state: GameStoreState): GameState['originalTree'] | null {
  return state.simState?.originalTree ?? null;
}
export function selectEconomy(state: GameStoreState): GameState['economy'] | null {
  return state.simState?.economy ?? null;
}
export function selectWorld(state: GameStoreState): GameState['world'] | null {
  return state.simState?.world ?? null;
}
export function selectAdvancedView(state: GameStoreState): boolean {
  return state.ui.advancedView;
}
export function selectSelectedTab(state: GameStoreState): string {
  return state.ui.selectedTab;
}
export function selectNotifications(state: GameStoreState): readonly UiNotification[] {
  return state.ui.notifications;
}
export function selectSelectedCurrencyId(state: GameStoreState): string {
  return state.ui.selectedCurrencyId;
}
/**
 * P5d — read the in-game reduced-motion override. The `useReducedMotion`
 * hook combines this with the OS `prefers-reduced-motion` media query.
 */
export function selectReducedMotionOverride(
  state: GameStoreState,
): 'auto' | 'on' | 'off' {
  return state.ui.reducedMotionOverride;
}
/**
 * P6d2 — read the parked "while you were away" summary. The OfflineModal
 * subscribes to this; returns `null` when no modal should render.
 */
export function selectPendingOfflineSummary(state: GameStoreState): OfflineSummary | null {
  return state.ui.pendingOfflineSummary;
}
export function selectEngineStatus(state: GameStoreState): EngineStatus {
  return state.engineStatus;
}
export function selectEvents(state: GameStoreState): readonly SimulationEvent[] {
  return state.events;
}

// ----------------------------------------------------------------------------
// Initial state (used by `create` and by the test reset helper).
// ----------------------------------------------------------------------------

export function initialGameUiState(): GameUiState {
  return {
    advancedView: false,
    selectedTab: PROVISIONAL_UI_DEFAULT_TAB,
    notifications: [],
    selectedCurrencyId: PROVISIONAL_UI_DEFAULT_CURRENCY_VISUAL_ID,
    reducedMotionOverride: 'auto',
    pendingOfflineSummary: null,
  };
}

// ----------------------------------------------------------------------------
// Store implementation.
// ----------------------------------------------------------------------------

export const useGameStore = create<GameStoreState>((set, get) => ({
  // --- Reactive fields ---
  simState: null,
  events: [],
  engineStatus: 'idle',
  ui: initialGameUiState(),

  // --- Simulation mutators ---

  /**
   * Dispatch a GameAction through the engine (TDD §4.1). Returns the events
   * the engine emitted; they're also appended to the `events` ring buffer
   * for the UI's recent-event log.
   *
   * Purity: `engine.executeAction` deep-copies the input state and returns a
   * fresh reference (TDD §4.1, rule 2). The store replaces `simState` with
   * that fresh reference; the previous reference is never mutated. This is
   * the ONLY path by which UI-initiated actions modify `simState`.
   *
   * Throws if the engine raises (e.g. `UnknownActionError`,
   * `InsufficientFundsError`, `OriginalTreeNotTransferableError`). The
   * store does NOT catch — the caller is expected to handle typed errors
   * (e.g. catch `InsufficientFundsError` in the purchase button and surface
   * a UI notification). P5b/P5c may wrap dispatch in a higher-level helper
   * that auto-converts typed errors into `pushNotification` calls.
   */
  dispatch: (action) => {
    const current = get().simState;
    if (!current) {
      // No state yet — the loop hasn't booted. Drop the action silently
      // rather than throwing (P5b's panels may dispatch on first paint
      // before the loop commits its first snapshot). The caller can check
      // `engineStatus === 'running'` before dispatching if it needs to gate.
      return [];
    }
    const result = engine.executeAction(current, action);
    set({
      simState: result.state,
      events: appendBounded(get().events, result.events, PROVISIONAL_UI_MAX_EVENT_LOG),
    });
    return result.events;
  },

  /**
   * Publish a new `simState` snapshot from the simulation loop. Called by
   * `useSimulationLoop` after `engine.advance(...)`. Replaces `simState`
   * (and appends emitted events) — the previous `simState` reference is
   * never mutated.
   *
   * NOT for UI code — UI dispatches actions and the engine decides what
   * changes. Exposed on the store so the loop (which lives outside React)
   * can publish without coupling to the store's internals.
   */
  commitSimState: (state, events) => {
    set({
      simState: state,
      events: appendBounded(get().events, events ?? [], PROVISIONAL_UI_MAX_EVENT_LOG),
    });
  },

  setEngineStatus: (status) => set({ engineStatus: status }),

  // --- UI mutators (NEVER mutate simState) ---
  //
  // Each mutator spreads `ui` to produce a new reference; `simState` is
  // untouched. Tests in `game-store.test.ts` prove the reference is
  // unchanged (TDD §16: "UI state must not be stored inside the biological
  // or economic simulation" — symmetric: UI mutations must not touch
  // simulation state).

  setAdvancedView: (enabled) =>
    set((s) => ({ ui: { ...s.ui, advancedView: enabled } })),

  setSelectedTab: (tab) =>
    set((s) => ({ ui: { ...s.ui, selectedTab: tab } })),

  setCurrencyCosmetic: (currencyId) =>
    set((s) => ({ ui: { ...s.ui, selectedCurrencyId: currencyId } })),

  /**
   * P5d — set the in-game reduced-motion override. `'auto'` follows the OS
   * `prefers-reduced-motion` setting via `matchMedia`; `'on'` / `'off'`
   * force the value. The `useReducedMotion()` hook reads this together with
   * the OS media query to compute the final boolean. UI mutator only —
   * `simState` is referentially unchanged (rule 6).
   */
  setReducedMotionOverride: (mode) =>
    set((s) => ({ ui: { ...s.ui, reducedMotionOverride: mode } })),

  pushNotification: (n) => {
    const notif: UiNotification = {
      ...n,
      id: nextNotificationId(),
      createdAtMs: Date.now(),
    };
    set((s) => ({
      ui: {
        ...s.ui,
        notifications: appendBounded(s.ui.notifications, [notif], PROVISIONAL_UI_MAX_NOTIFICATIONS),
      },
    }));
    return notif;
  },

  dismissNotification: (id) =>
    set((s) => ({
      ui: {
        ...s.ui,
        notifications: s.ui.notifications.filter((n) => n.id !== id),
      },
    })),

  clearNotifications: () =>
    set((s) => ({ ui: { ...s.ui, notifications: [] } })),

  // --- P6d2: pending offline summary (UI mutators — never touch simState) ---

  setPendingOfflineSummary: (summary) =>
    set((s) => ({ ui: { ...s.ui, pendingOfflineSummary: summary } })),

  clearPendingOfflineSummary: () =>
    set((s) => ({ ui: { ...s.ui, pendingOfflineSummary: null } })),

  // --- UI-only action dispatch ---
  //
  // `applyUiAction` is the symmetric counterpart to `dispatch` for the
  // `UiAction` union (UI-only actions defined in `lib/actions.ts` that do
  // NOT route through the engine). P5a only ships one variant
  // (`set-currency-cosmetic`); P5b/P5c may add more (e.g. `set-tab`,
  // `toggle-panel`).
  applyUiAction: (action) => {
    switch (action.type) {
      case 'set-currency-cosmetic':
        get().setCurrencyCosmetic(action.payload.currencyId);
        return;
    }
    // Exhaustiveness guard: if a new UiAction variant is added without a
    // case above, TypeScript's switch-on-discriminant will fail to narrow
    // `action` to `never` here (because the new variant remains
    // unhandled), surfacing the missing case at compile time when the
    // union grows beyond a single variant. Runtime throw is a defensive
    // backstop.
    const unhandled: { type: string } = action as { type: string };
    throw new Error(`applyUiAction: unhandled UiAction variant "${unhandled.type}"`);
  },
}));

// Re-export the SetCurrencyCosmeticAction type so consumers can `import
// { setCurrencyCosmetic, type SetCurrencyCosmeticAction }` from one place.
export type { SetCurrencyCosmeticAction } from '../lib/actions';

/**
 * Test-only helper: reset the store to its initial state (null simState,
 * empty events, default UI slice, idle engineStatus). Used by tests in
 * `game-store.test.ts` and `useSimulationLoop.test.ts` to start each test
 * from a clean slate. NOT for production code.
 *
 * Also resets the internal notification counter so test snapshots are
 * deterministic.
 */
export function __resetGameStoreForTests(): void {
  _notificationCounter = 0;
  useGameStore.setState({
    simState: null,
    events: [],
    engineStatus: 'idle',
    ui: initialGameUiState(),
  });
}
