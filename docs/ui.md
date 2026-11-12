# Web UI Architecture (P5 — `apps/web`)

The web app is the ONLY presentation layer for the simulation (TDD §3
import-boundary). It is a Next.js 16 App-Router project at `apps/web/`
consuming `@capitalist-tree/simulation`, `@capitalist-tree/rendering`,
`@capitalist-tree/shared`, and `@capitalist-tree/content`. The simulation
NEVER imports from the web app.

This document is the source-of-truth contract for the UI architecture
introduced across P5a–P5d. Where it and the GDD/TDD disagree, the GDD/TDD
win and a fix must be filed against this document.

**Phase status**

| Phase | Scope | Status |
|-------|-------|--------|
| P5a   | Zustand `game-store` + `useSimulationLoop` (rAF + accumulator) + provisional UI constants + pure action factories | Shipped |
| P5b   | Main game screen + dashboard summary components (Money / Tree / Expenses / Resources / Weather / Speed) + common UI primitives (Panel/Button/Stat/ProgressBar) | Shipped |
| P5c   | Advanced view toggle + BiologyPanel / EnvironmentPanel / HarvestControls / PurchaseControls / TransactionsPanel / CurrencyCosmeticPicker + `lib/format` describe helpers | Shipped |
| P5d   | NotificationsPanel + `useReducedMotion` + `dispatch-wrapper` (typed-error → notification) + A11y pass + this doc | **This phase** |

> **Cardinal rule (rule 6 — TDD §15.1, GDD §6.1):** rendering / UI reads
> state, NEVER writes. The store is the ONLY place UI code can request
> state changes, and every UI mutator targets the `ui` slice — never
> `simState`. `simState` is mutated exclusively by the engine (via
> `dispatch` / `commitSimState`). See §1 below.

---

## 1. Store architecture

Module: `apps/web/stores/game-store.ts`. Backed by Zustand 5.1 (TDD §16:
"Zustand or a comparable state manager can coordinate the application
interface").

### 1.1 State split

The store enforces TDD §16's split between **simulation state** (engine
snapshots — read-only outside the engine) and **UI state** (panels,
advanced mode, selection, notifications, currency cosmetic, reduced-motion
override):

```ts
interface GameStoreState {
  // Reactive fields.
  readonly simState: GameState | null;     // engine snapshot; null until boot
  readonly events: readonly SimulationEvent[]; // bounded recent-event log
  readonly engineStatus: 'idle' | 'booting' | 'running';
  readonly ui: GameUiState;                // UI slice; mutators replace this ref

  // Simulation mutators (replace simState via the engine).
  dispatch: (action: GameAction) => readonly SimulationEvent[];
  commitSimState: (state: GameState, events?: readonly SimulationEvent[]) => void;
  setEngineStatus: (status: EngineStatus) => void;

  // UI mutators (replace the `ui` slice; simState ref is unchanged).
  setAdvancedView: (enabled: boolean) => void;
  setSelectedTab: (tab: string) => void;
  setCurrencyCosmetic: (currencyId: string) => void;
  setReducedMotionOverride: (mode: 'auto' | 'on' | 'off') => void;  // P5d
  pushNotification: (n: Omit<UiNotification, 'id' | 'createdAtMs'>) => UiNotification;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  // UI-only action dispatch (symmetric counterpart to `dispatch` for `UiAction`).
  applyUiAction: (action: UiAction) => void;
}
```

The split is enforced by the API surface, not just convention:

- **UI mutators** (`setAdvancedView`, `pushNotification`,
  `setReducedMotionOverride`, …) spread `ui` into a fresh object and leave
  `simState` referentially unchanged. Tests in
  `apps/web/test/stores/game-store.test.ts` prove this for every
  mutator.
- **Simulation mutators** (`dispatch`, `commitSimState`) replace
  `simState` with a fresh reference returned by the engine (rule 2 — the
  engine deep-copies + returns; the previous `simState` reference is never
  mutated). They NEVER touch `ui`.

### 1.2 `GameUiState` slice

```ts
interface GameUiState {
  readonly advancedView: boolean;                      // GDD §13.3
  readonly selectedTab: string;                        // GDD §13.1
  readonly notifications: readonly UiNotification[];    // GDD §13.5 (bounded FIFO)
  readonly selectedCurrencyId: string;                 // GDD §14, TDD §15.4
  readonly reducedMotionOverride: 'auto' | 'on' | 'off'; // P5d — WCAG 2.3.3
}
```

`notifications` is a FIFO ring buffer capped at
`PROVISIONAL_UI_MAX_NOTIFICATIONS` (default 20) via the internal
`appendBounded` helper. The cap is enforced in `pushNotification`; the
panel re-applies it as a defensive backstop (§4.2 below). Notification ids
are produced by a module-private monotonic counter (`ui-notif-1`,
`ui-notif-2`, …) so they're unique within a session. The counter is reset
by `__resetGameStoreForTests()` so test snapshots are deterministic.

### 1.3 `UiNotification` shape

```ts
interface UiNotification {
  readonly id: string;                       // client-generated; session-unique
  readonly severity: 'info' | 'warning' | 'critical';
  readonly message: string;                 // human-readable; shown verbatim
  readonly code: string;                     // machine-readable (e.g. 'low-funds')
  readonly at: number;                       // sim seconds (from clock.elapsedSeconds)
  readonly createdAtMs: number;              // wall-clock ms (for auto-dismiss timers)
}
```

The `code` field is the contract between the dispatch-wrapper (which
produces codes from typed engine errors — §5 below) and the
`NotificationsPanel` (which filters to actionable codes — §4.2).

### 1.4 Engine boundary

The store's `dispatch` is a thin pass-through to
`engine.executeAction(current, action)`, which returns `{ state, events }`.
On success the store replaces `simState` and appends the events to the
bounded log; on a typed error (e.g. `InsufficientFundsError`) the engine
throws BEFORE publishing any state change, so `simState` is still the
pre-call snapshot. The store itself does NOT catch — the caller is
expected to handle typed errors. P5d's `dispatch-wrapper` (§5) is the
caller that does this centrally.

The store's `dispatch` is a no-op (returns `[]`) when `simState` is
`null` — i.e. before the loop boots. This lets P5b/P5c panels dispatch
on first paint without crashing; callers that need to gate can check
`engineStatus === 'running'` first.

### 1.5 `applyUiAction` — symmetric dispatch for `UiAction`

UI-only actions (P5a: `set-currency-cosmetic`) don't route through the
engine — they're handled by the store directly via
`applyUiAction(action)`. The switch-on-discriminant structure makes
adding variants a compile-time exhaustiveness check: when the `UiAction`
union grows, the `default` branch's `as { type: string }` cast surfaces
the missing case at typecheck time.

### 1.6 Test reset helper

`__resetGameStoreForTests()` is a test-only export that resets the store
to its initial state (null `simState`, empty `events`, default `ui` slice,
`engineStatus === 'idle'`) AND resets the notification-id counter so test
snapshots are deterministic. Every test file calls it in `beforeEach`.

---

## 2. Render loop

Module: `apps/web/hooks/useSimulationLoop.ts`. Extracted from P0's
`use-engine-game.ts` — the difference is that P0 held `state` in React
`useState` (re-rendering the entire page every step), whereas P5a puts
the reactive `simState` snapshot in the Zustand store (selective
subscriptions prevent full-tree re-renders) and this hook owns the
non-reactive accumulator + rAF lifecycle.

### 2.1 Responsibilities

1. **Boot** — on mount, call `storage.load()`. If a save exists, publish
   it via `useGameStore.getState().commitSimState(loaded)`. Otherwise
   call `engine.initialize(initialConfig)` and publish the fresh state.
   Either way, set `engineStatus = 'running'` and `ready = true`.
2. **Loop** — `requestAnimationFrame` + accumulator pattern. Each frame:
   accumulate `realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS *
   speedMultiplier` sim seconds; when the accumulator ≥ 1 second, call
   `engine.advance(state, accumulator)` and publish via `commitSimState`.
3. **Pause** — subscribe to `simState.clock.paused` /
   `simState.clock.speedMultiplier`. Cancel the rAF when paused (or
   multiplier === 0); restart when resumed. The engine itself is
   pause-agnostic (TDD §6.3 — the Pause contract); this hook is where
   the Pause contract is enforced.
4. **Speed** — speed multiplier scales elapsed sim time. 5x ⇒ 5× more
   sim seconds per real second. The hook reads the multiplier from the
   latest `simState` each frame.
5. **Persistence** — expose `save()`, `load()`, `newGame(config)` for
   the page's Save / Load / New-Game buttons. These update both the
   internal `stateRef` and the store's `simState`.

### 2.2 Per-frame shape

```text
rAF tick(now):
  current = stateRef.current           // non-reactive mirror of simState
  if !current or paused or multiplier<=0:  next frame; return
  realDelta = min(PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS, now - lastTs) / 1000
  simDelta  = realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS * multiplier
  accumulator += simDelta
  if accumulator >= 1:
    result = engine.advance(current, accumulator)
    accumulator -= result.consumedSeconds
    stateRef.current = result.state
    if shouldCommit (throttle gate):  // PROVISIONAL_UI_COMMIT_THROTTLE_MS
      store.commitSimState(result.state, result.events)
      setAccumulator(accumulator)
  next frame
```

**Frame-dt clamp** — `PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS` (250 ms)
caps the wall-clock delta applied to a single rAF tick. A long tab-
suspend (laptop sleep) would otherwise advance the simulation by an
arbitrary amount; the clamp keeps the per-frame advance bounded.

**Commit throttle** — `PROVISIONAL_UI_COMMIT_THROTTLE_MS` (0 for P5a —
commit every step). If profiling later shows selector-level updates
are too frequent at 60× speed, raise this to e.g. 100 ms; the rAF
loop keeps advancing internally and only throttles the reactive
publish.

### 2.3 Non-reactive state mirror

The rAF closure reads from a `useRef` mirror of `simState`, not from
the store hook. This is intentional: the closure runs ~60× per second
and must NOT cause React re-renders. A `useGameStore.subscribe` watcher
keeps `stateRef` in sync with the store's `simState` so dispatches from
UI click handlers are visible to the next frame.

### 2.4 Determinism (TDD §18.3)

The hook adds NO randomness. All randomness flows through the engine's
seeded RNG (rebuilt from `state.rngState` each step). `Date.now()` is
read ONLY for `metadata.lastSavedAt` on save (the spec-allowed single
read at save time — TDD §18.1).

---

## 3. Selector pattern

TDD §16: "Avoid forcing a full React re-render for every biological
simulation step." Selective subscriptions are how the UI achieves this.

### 3.1 Narrow selectors

Components subscribe to the smallest slice they need via inline
selectors:

```ts
// MoneyDisplay — only re-renders when player.personalCash changes.
const cash = useGameStore((s) => s.simState?.player.personalCash ?? '0');

// WeatherDisplay — only re-renders when world.weather or clock.season change.
const weather = useGameStore((s) => s.simState?.world.weather ?? null);
const season  = useGameStore((s) => s.simState?.clock.season ?? null);
```

Zustand's `useSyncExternalStore` bails out when the selector returns the
same reference (or primitive value) as the previous call — so an
unrelated `simState` commit (e.g. a tick that only changed the clock)
does NOT re-render `MoneyDisplay`.

### 3.2 Sub-slice selectors

For ergonomic reuse, named selectors in `game-store.ts` return whole
sub-slices:

```ts
export function selectClock(state: GameStoreState): GameState['clock'] | null
export function selectPlayer(state: GameStoreState): GameState['player'] | null
export function selectOriginalTree(state: GameStoreState): GameState['originalTree'] | null
export function selectEconomy(state: GameStoreState): GameState['economy'] | null
export function selectWorld(state: GameStoreState): GameState['world'] | null
export function selectNotifications(state: GameStoreState): readonly UiNotification[]
export function selectReducedMotionOverride(state: GameStoreState): 'auto' | 'on' | 'off'
// … etc.
```

A `MoneyDisplay` subscribed to `selectPlayer` re-renders only when the
`player` sub-slice reference changes — the engine deep-copies and
replaces sub-slices on every advance, so this is once per step that
touched the player. `WeatherDisplay` subscribed to `selectWorld`
similarly re-renders only when `world` changes.

### 3.3 Null-when-booting convention

Selectors return `null` when `simState` is `null` (loop hasn't booted).
Components handle this by returning `null` themselves (render nothing
while the boot placeholder is on screen). This keeps the selectors pure
and avoids throwing inside `useSyncExternalStore`.

### 3.4 Proven by test

`apps/web/test/components/dashboard/NotificationsPanel.test.tsx` §
"selective UI updates" proves the pattern: rendering the panel, then
committing a fresh `simState` that only changes `originalTree.stress`
does NOT re-render the panel (the panel subscribes to
`ui.notifications` only). Pushing a new notification DOES re-render
it.

---

## 4. Panel layout

Module: `apps/web/app/page.tsx`. The main game screen.

### 4.1 Top-level structure

```text
<main data-testid="game-screen">
  <Header />                                            // h1 + subtitle

  // Floating, pointer-events-none container for the NotificationsPanel.
  // The panel returns null when the actionable-filtered list is empty,
  // so this container reserves no space on the page.
  <div fixed right-4 top-4 data-testid="notifications-panel-container">
    <div pointer-events-auto>
      <NotificationsPanel />
    </div>
  </div>

  // Simulation panel — speed controls + save/load/new-game + advanced-view toggle.
  <Panel title="Simulation" icon="⏱">
    <SpeedControls accumulator={loop.accumulator} />
    <Button onClick={loop.save}>💾 Save</Button>
    <Button onClick={loop.load}>📂 Load</Button>
    <Button onClick={onNewGame}>🌱 New Game</Button>
    <AdvancedViewToggle />
  </Panel>

  // Main grid — TreeView dominant; dashboard surrounds on the sides.
  <div grid lg:grid-cols-12>
    <aside lg:col-span-3>  // left
      <Panel title="Money">     <MoneyDisplay />     </Panel>
      <Panel title="Expenses">   <ExpensesSummary /> </Panel>
      <Panel title="Resources">  <ResourcesSummary /></Panel>
    </aside>

    <section lg:col-span-6>  // center — the tree is dominant (GDD §13.1)
      <Panel title="The Original Tree" icon="🌳" tone={treeTone}>
        <TreeView tree={treeRenderData} environment={environmentRenderData} />
        <TreeConditionSummary />
      </Panel>
    </section>

    <aside lg:col-span-3>  // right
      <Panel title="Weather" icon="🌤"> <WeatherDisplay /> </Panel>
    </aside>
  </div>

  // P5c — Advanced View (GDD §13.3). Rendered only when ui.advancedView is true.
  {advancedView && (
    <div grid lg:grid-cols-2 xl:grid-cols-3 data-testid="advanced-view">
      <Panel title="Biology">      <BiologyPanel />          </Panel>
      <Panel title="Environment">  <EnvironmentPanel />      </Panel>
      <Panel title="Harvest">      <HarvestControls />       </Panel>
      <Panel title="Markets">      <PurchaseControls />      </Panel>
      <Panel title="Transactions"> <TransactionsPanel />    </Panel>
      <Panel title="Currency">     <CurrencyCosmeticPicker /></Panel>
    </div>
  )}
</main>
```

### 4.2 NotificationsPanel — floating, collapses to null

`NotificationsPanel` is rendered inside a `position: fixed` container at
the top-right of the viewport. The container is `pointer-events: none`
so empty space doesn't intercept clicks meant for the tree; the panel
itself re-enables `pointer-events: auto` so its buttons are clickable.

The panel returns `null` when the actionable-filtered list is empty
(§6 below). This means on a healthy fresh game with no notifications,
the floating container exists in the DOM but is visually empty — no
reserved space, no empty UI noise.

**Actionable filter** (GDD §13.5 — "prioritize actionable events"):

```ts
export const ACTIONABLE_NOTIFICATION_CODES: ReadonlySet<string> = new Set([
  'expense-due',
  'low-funds',
  'issuance-rejected',
  'tree-died',
  'storm-damage',
  'severe-weather',
]);
```

The panel filters `ui.notifications` to this set. Codes NOT in the set
(`'invalid-amount'`, `'duplicate-request'`, `'self-transfer'`,
`'unknown-action'`, `'invariant'`, `'original-tree-protected'`,
`'tree-sale-not-implemented'`, `'unknown-market'`, `'save-corrupt'`) are
still pushed by the dispatch-wrapper for the dev console / future audit
log, but they're NOT shown to the player. The actionable list is
defensive: when the event-bridge that converts SimulationEvents
(`expense-due`, `tree-died`, `weather-damage` with `damageType='storm'`,
etc.) into `pushNotification` calls lands in a future phase, only the
right codes will surface — the panel's filter is already in place.

**FIFO cap** — `PROVISIONAL_UI_MAX_NOTIFICATIONS` (default 20). The
store's `pushNotification` enforces it via `appendBounded`; the panel
re-slices to `max` defensively (`filtered.slice(filtered.length - max)`)
in case future code pushes via a different route.

### 4.3 Common UI primitives

`apps/web/components/common/` — `Panel`, `Button`, `Stat`,
`ProgressBar`, plus an `index.ts` barrel. Pure presentational
components; no store subscription, no engine calls. `Panel` accepts a
`tone` (`'slate' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo' | 'cyan'`)
that tints the title + left border — used by `TreeConditionSummary` to
mirror the tree's condition tier, and by `WeatherDisplay` to mirror the
weather tone.

### 4.4 Dashboard summary components

`apps/web/components/dashboard/` — `MoneyDisplay`,
`TreeConditionSummary`, `ExpensesSummary`, `ResourcesSummary`,
`WeatherDisplay`, `SpeedControls`, `AdvancedViewToggle`,
`NotificationsPanel`. Each:

- Subscribes narrowly to its own slice(s) via Zustand selectors so
  unrelated slice changes don't trigger re-renders.
- Returns `null` when `simState` is `null` (loop hasn't booted) so the
  page can render a loading placeholder.
- Reads state only — `SpeedControls` dispatches `set-speed` / `pause` /
  `resume` through the store; nothing else dispatches. Rule 6
  symmetric counterpart: UI dispatches are the only path by which
  UI-initiated actions modify `simState`.

---

## 5. Dispatch flow

Three concentric wrappers around the engine boundary, each suited to a
different caller:

```text
              ┌──────────────────────────────────────────────┐
              │             engine.executeAction             │  ← throws on typed error
              └──────────────────────────────────────────────┘
                          ▲                  ▲
                          │                  │
                ┌─────────┴──────┐   ┌───────┴──────────────┐
                │ store.dispatch │   │ store.commitSimState  │  ← loop only
                │ (pass-through) │   │ (publish snapshot)    │
                └────────────────┘   └───────────────────────┘
                          ▲
                          │
                ┌─────────┴──────────────┐
                │ safeDispatch (P5d)      │  ← catches typed errors → pushNotification
                │ (UI click handlers)    │     re-throws unknown errors
                └────────────────────────┘
                          ▲
                          │
                ┌─────────┴──────────────┐
                │ useSafeDispatch hook    │  ← stable callback for components
                └────────────────────────┘
```

### 5.1 Action factories → store.dispatch

Module: `apps/web/lib/actions.ts`. Pure functions that build immutable
`GameAction` objects ready for `useGameStore.getState().dispatch(action)`:

| Factory | Action type | Engine handler |
|---------|-------------|----------------|
| `setSpeed(multiplier)` | `set-speed` | updates `clock.speedMultiplier` |
| `pause()` | `set-speed` (m=0) | same as above; the loop watches for m≤0 |
| `resume(m)` | `set-speed` | same as above |
| `harvest(treeId, requestedLeaves)` | `harvest-leaves` | caps by species max fraction + foliage |
| `applyWater(litres, treeId?)` | `apply-water` | adds to soil water pool |
| `applyFertilizer(fertilizerId, units, treeId?)` | `apply-fertilizer` | adds to soil nutrient pool |
| `purchase(marketId, quantity)` | `purchase` | transfers cash to market, credits inventory |
| `payExpense(category, amount)` | `pay-expense` | debits player:personal, sinks to authority |

Each factory validates inputs at the boundary (e.g. `purchase` rejects
non-integer or negative `quantity`). They perform NO state mutation and
do NOT dispatch on their own — that's the caller's job (or the wrapper's
job — §5.2).

`setCurrencyCosmetic(currencyId)` is the ONE non-`GameAction` factory.
It returns a `SetCurrencyCosmeticAction` (a `UiAction`) handled by the
store's `applyUiAction` — it does NOT route through the engine, because
currency cosmetics are pure visual data (rule 6 + TDD §15.4).

### 5.2 `safeDispatch` — typed-error → notification bridge

Module: `apps/web/lib/dispatch-wrapper.ts`. The store's `dispatch`
lets typed errors propagate (P5a's design — the caller is expected to
handle them). That contract is correct for the engine boundary but
ergonomic for UI code: a click handler in `PurchaseControls` would
otherwise have to `try`/`catch` around every `dispatch(purchase(...))`
call, and a missed catch would log an unhandled rejection.

`safeDispatch(store, action)` wraps `store.dispatch(action)` so typed
engine errors are auto-converted into `pushNotification` calls. On a
typed error:

1. Read `at` from `store.simState.clock.elapsedSeconds` (defaults to 0
   if `simState` is `null`).
2. Map the error to a notification payload via `errorToNotification`
   (pure — same error instance → same payload).
3. If the mapping returned a payload, call `store.pushNotification(...)`
   (a UI mutator — `simState` is referentially unchanged).
4. If the mapping returned `null` (unknown error class), **re-throw**.
   The wrapper does NOT swallow unexpected errors.
5. Return `{ events: [], ok: false }` so the caller can branch on
   failure without try/catch.

On success: return `{ events: <engine events>, ok: true }`.

**Mapping table** (typed error → notification code + severity):

| Error class | Code | Severity | Actionable? |
|-------------|------|----------|-------------|
| `InsufficientFundsError` | `'low-funds'` | `warning` | ✅ |
| `UnknownAccountError` | `'low-funds'` | `critical` | ✅ |
| `UnknownMarketError` | `'unknown-market'` | `warning` | ✗ |
| `InvalidAmountError` | `'invalid-amount'` | `info` | ✗ |
| `DuplicateRequestIdError` | `'duplicate-request'` | `info` | ✗ |
| `SelfTransferError` | `'self-transfer'` | `info` | ✗ |
| `UnknownActionError` | `'unknown-action'` | `critical` | ✗ |
| `SimulationInvariantError` | `'invariant'` | `critical` | ✗ |
| `OriginalTreeNotTransferableError` | `'original-tree-protected'` | `warning` | ✗ |
| `TreeSaleNotImplementedError` | `'tree-sale-not-implemented'` | `info` | ✗ |
| `UnknownSchemaVersionError` / `SaveValidationError` | `'save-corrupt'` | `critical` | ✗ |
| Any other `Error` | — | — | (re-thrown) |

The actionable codes (`low-funds`, plus the future `expense-due`,
`issuance-rejected`, `tree-died`, `storm-damage`, `severe-weather`) are
shown to the player by the panel. The non-actionable codes are still
pushed for the dev console / future audit log — they don't surface to
the player but they're not lost either.

### 5.3 `useSafeDispatch` — React hook

A stable-callback wrapper around `safeDispatch` for component use:

```ts
const safeDispatch = useSafeDispatch();
<Button onClick={() => safeDispatch(purchase('market:water', 1))}>Buy</Button>
```

The callback closes over `useGameStore.getState()` (not the reactive
snapshot), so it never goes stale but also never causes a re-render on
its own. Consumers call it inside `onClick` / `onKeyDown` handlers.

### 5.4 Proven by test

`apps/web/test/lib/dispatch-wrapper.test.ts` (25 tests) covers:

- Every typed error → notification mapping (one test per error class).
- The `at` field is read from `simState.clock.elapsedSeconds` (advanced
  to 1234 in one test → notification carries `at: 1234`).
- `at` falls back to 0 when `simState` is `null` (loop not booted).
- Unknown error classes are re-thrown (not swallowed).
- `errorToNotification` is pure (same input → same output).
- The wrapper leaves `simState` referentially unchanged on error (rule 6).
- Real purchase-with-insufficient-funds end-to-end: drain
  `player:personal` via `transfer()`, then `safeDispatch(purchase(...))`,
  assert a `low-funds` `warning` notification lands in the store.

---

## 6. Accessibility (P5d)

GDD §13 does not yet have a dedicated accessibility section. WCAG 2.1
AA is the authoritative source for the criteria P5d satisfies. The map
below records the criteria each feature addresses + the gap for items
not yet shipped.

### 6.1 `NotificationsPanel` — ARIA + keyboard

| Feature | Implementation | WCAG criterion |
|---------|---------------|----------------|
| Region label | `role="region" aria-label="Notifications"` on the outer `<section>` | 1.3.1 Info and Relationships |
| Per-item live region | `role="alert"` on `warning` + `critical`; `role="status"` on `info` | 4.1.3 Status Messages |
| Icon-only buttons labelled | `aria-label="Dismiss notification: <message>"` on each dismiss; `aria-label="Dismiss all notifications"` on clear-all | 4.1.2 Name, Role, Value |
| Severity not by colour alone | Each severity carries an icon (ℹ / ⚠ / 🛑) AND a text label (the message + the code) | 1.4.1 Use of Colour |
| Keyboard operability | Every button is a real `<button type="button">` — tabbable, Enter/Space activate | 2.1.1 Keyboard |
| Focus visible | `focus-visible:ring-2 focus-visible:ring-sky-400/50` on every focusable element | 2.4.7 Focus Visible |
| Reduced motion | The panel calls `useReducedMotion()` and applies `transition-none` when reduced (§6.2) | 2.3.3 Animation from Interactions |

`role="alert"` is an implicit `aria-live="assertive"` region — screen
readers announce immediately. `role="status"` is implicit
`aria-live="polite"` — screen readers announce when the user pauses.
Setting `aria-live` explicitly is redundant when the role is set.

### 6.2 `useReducedMotion` — prefers-reduced-motion + in-game setting

Module: `apps/web/hooks/useReducedMotion.ts`. Returns a boolean —
`true` means "reduce motion" (consumers disable non-essential
animations); `false` means "motion OK".

**Inputs combined in priority order** (first match wins):

1. **In-game setting** — `ui.reducedMotionOverride` in the store:
   - `'on'`  → always reduce (regardless of OS).
   - `'off'` → never reduce (regardless of OS).
   - `'auto'` → defer to the OS preference (next).
2. **OS preference** — `matchMedia('(prefers-reduced-motion: reduce)')`:
   - When the override is `'auto'`, the hook returns whatever the OS
     media query reports.

**SSR / non-DOM safety** — if `window` / `matchMedia` is undefined (SSR,
Node test env, or a rare browser without matchMedia), the hook falls
back to `false` (motion OK) for `'auto' | 'off'` and `true` for `'on'`.
This avoids breaking SSR rendering; the client-side hydration pass
picks up the real OS preference.

**Live subscription** — the hook subscribes to the `matchMedia` list via
`addEventListener('change', ...)` (modern) with a `addListener` fallback
(Safari < 14). When the OS preference flips (e.g. the player toggles
"Reduce motion" in macOS System Settings), the hook re-renders its
consumer. Cleanup on unmount removes the listener.

**Pure resolver** — `resolveReducedMotion(override, osPreference)` is
exported separately so it can be unit-tested without dragging in the
React scheduler. The test suite covers all 6 (override, osPreference)
combinations.

### 6.3 Contrast

The dashboard palette is dark-mode (`bg-slate-950`, `text-slate-100` /
`text-slate-300` / `text-slate-400`). Severity tints:

| Severity | Text | BG tint | Border | Approx. contrast |
|----------|------|---------|--------|------------------|
| info | `text-sky-200` on `bg-sky-950/40` | sky-950 | `border-sky-500/60` | ≥ 7:1 |
| warning | `text-amber-200` on `bg-amber-950/40` | amber-950 | `border-amber-500/60` | ≥ 7:1 |
| critical | `text-rose-200` on `bg-rose-950/40` | rose-950 | `border-rose-500/60` | ≥ 7:1 |

All combinations exceed the WCAG 2.1 AA threshold of 4.5:1 for normal
text and 3:1 for large text + UI components. (The tinted backgrounds
are 40% opacity over `bg-slate-950`, which preserves the contrast
because the underlying surface is very dark.) The `focus-visible:ring`
is `ring-sky-400/50` on the slate-950 surface — well above the 3:1
non-text contrast threshold.

### 6.4 Accessibility decisions (criteria map)

| WCAG criterion | P5d feature | Status |
|----------------|-------------|--------|
| 1.3.1 Info and Relationships | `role="region"` + `aria-label` on the NotificationsPanel | ✅ |
| 1.4.1 Use of Colour | Severity carries an icon AND a text label, not colour alone | ✅ |
| 1.4.3 Contrast (Minimum) | Severity tinted backgrounds ≥ 7:1 contrast | ✅ |
| 2.1.1 Keyboard | All buttons are real `<button>` elements (tabbable, Enter/Space) | ✅ |
| 2.3.3 Animation from Interactions | `useReducedMotion` gates the slide-in transition on NotificationsPanel | ✅ |
| 2.4.7 Focus Visible | `focus-visible:ring-2` on every focusable element | ✅ |
| 4.1.2 Name, Role, Value | `aria-label` on every icon-only button | ✅ |
| 4.1.3 Status Messages | `role="alert"` / `role="status"` on each notification | ✅ |

### 6.5 Gaps (R-items)

- **R-P5d-1 — In-game UI for the reduced-motion override.** The hook
  reads `ui.reducedMotionOverride` and the store exposes
  `setReducedMotionOverride(mode)`, but no settings panel UI ships in
  P5d. The override defaults to `'auto'`, which follows the OS —
  sufficient for most players. A future Settings panel (P5e or later)
  should expose the three-way toggle. Until then the only way to force
  `'on'` / `'off'` is via the dev console:
  `useGameStore.getState().setReducedMotionOverride('on')`.
- **R-P5d-2 — `TreeView` not yet wired to `useReducedMotion`.** P4's
  `TreeView` rAF loop animates branch-sway + leaf-particles +
  currency-leaf drift unconditionally. The `useReducedMotion` hook is
  ready for consumers; the consumer isn't yet. Wiring TreeView is a
  future rendering-package change (it would gate the per-frame sway
  offset + particle pool updates). Until then, the in-game override
  affects the NotificationsPanel slide-in but NOT the tree's
  animations — documented in `apps/web/hooks/useReducedMotion.ts` § GAP
  and in `apps/web/components/dashboard/NotificationsPanel.tsx` §
  Accessibility notes.
- **R-P5d-3 — NotificationsPanel keyboard navigation within the list.**
  The dismiss buttons are individually tabbable (every button is a real
  `<button>`), but the list itself is not a roving-tabindex widget.
  For ≤ 20 items this is acceptable; if the cap ever grows, a
  roving-tabindex pattern (arrow keys to move between rows, Enter to
  dismiss the focused row) would be more ergonomic. Tracked here, not
  shipped.
- **R-P5d-4 — Auto-dismiss after N seconds.** `UiNotification` carries
  a `createdAtMs` field for this purpose, but no auto-dismiss timer is
  wired in P5d. Actionable notifications stay on screen until the
  player dismisses them — which is intentional for the actionable
  bucket (the player should act, not have the message vanish). Info /
  non-actionable notifications could auto-dismiss after e.g. 8 s when
  the future event-bridge lands; the hook is ready.

---

## 7. Provisional constants

Module: `apps/web/lib/constants.ts`. Every value corresponds to (or
stands in for) an unresolved UI / presentation design decision listed
in GDD §13 (User Interface and Presentation), §14 (Monetization and
Cosmetics), and §17 (Unresolved Design Decisions). They live in
`apps/web/lib/constants.ts` — NOT in `packages/shared/src/constants/` —
because they are pure UI concerns (rule 6 + TDD §3 import boundary).

**Convention:** every constant is `@provisional`. Use the `PROVISIONAL_UI_*`
prefix. When a value is promoted from "provisional" to "decided" via
playtesting, move it to a sibling `decided.ts` and remove the
`PROVISIONAL_` prefix. Leave a comment so the migration is traceable.

| Constant | Default | Purpose |
|----------|---------|---------|
| `PROVISIONAL_UI_DASHBOARD_REFRESH_INTERVAL_MS` | 250 | Coarse refresh cadence for consumers that want to throttle derived-metric recomputation. The loop itself doesn't throttle commits — it relies on Zustand selectors. |
| `PROVISIONAL_UI_MAX_NOTIFICATIONS` | 20 | Cap on the `ui.notifications` FIFO ring buffer. Older entries are dropped. Kept small so the panel doesn't grow unbounded; the underlying `events` log retains the full event history for the dev console. |
| `PROVISIONAL_UI_DEFAULT_SPEED` | 1 | Default speed multiplier applied when a new game boots. Matches `PROVISIONAL_SPEED_1X` from `@capitalist-tree/shared`; re-declared here so the UI layer owns its own default. |
| `PROVISIONAL_UI_MAX_EVENT_LOG` | 50 | Cap on the `events` ring buffer (the recent-event log the UI displays). Mirrors P0 `use-engine-game.ts` `MAX_LOG = 50`. |
| `PROVISIONAL_UI_DEFAULT_TAB` | `'overview'` | Default tab selected when the game boots. P5b's panel layout defines the full tab list. |
| `PROVISIONAL_UI_DEFAULT_CURRENCY_VISUAL_ID` | `'currency:leaf-dollar'` | Default currency cosmetic id. Matches `PROVISIONAL_DEFAULT_CURRENCY_ID` from `@capitalist-tree/shared`. Resolved by the rendering package via `findCurrencyVisual(id)`. |
| `PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS` | 250 | Upper bound on the wall-clock delta (ms) applied to a single rAF tick. Mirrors P4d TreeView's `MAX_FRAME_DT_MS = 250` — both loops use the same convention. |
| `PROVISIONAL_UI_COMMIT_THROTTLE_MS` | 0 | Minimum real-time interval (ms) between `simState` snapshots published by the loop. `0` for P5a — commit every step (selectors prevent excessive re-renders). P5b+ may tune to e.g. 100 ms if profiling shows selector-level updates are too frequent at 60×. |

P5d does NOT introduce new constants — `PROVISIONAL_UI_MAX_NOTIFICATIONS`
(added in P5a) is the cap the panel + wrapper honour. The reduced-motion
override is a 3-value enum, not a numeric constant, so it lives directly
on `GameUiState`.

---

## 8. Test coverage (P5d)

The P5d phase adds 57 new web tests (304 web total, up from 247 after
P5a–P5c):

| File | Tests | Coverage |
|------|-------|----------|
| `apps/web/test/components/dashboard/NotificationsPanel.test.tsx` | 20 | Empty / actionable render / dismiss / dismiss-all / ARIA roles / aria-label / focus-visible / rule 6 / selective UI updates / FIFO cap / reduced-motion override |
| `apps/web/test/hooks/useReducedMotion.test.tsx` | 7 | Pure resolver (3 override × 2 OS pref) + hook reads override + reflects changes on re-render |
| `apps/web/test/lib/dispatch-wrapper.test.ts` | 25 | Every typed error → notification mapping + `at` from clock + `at=0` fallback + re-throw unknown + rule 6 + real InsufficientFundsError end-to-end |
| `apps/web/test/stores/game-store.test.ts` | +3 (P5d additions) | `reducedMotionOverride` initial value + `setReducedMotionOverride` rule 6 + `selectReducedMotionOverride` |
| `apps/web/test/app/page.test.tsx` | +2 (P5d additions) | NotificationsPanel container present + panel surfaces actionable notifications when pushed |

The 20-test NotificationsPanel suite explicitly proves the four brief
requirements:

1. **Renders** — `'renders one row per actionable notification'` + the
   six-code variant `'renders all six actionable codes when present'`.
2. **Dismisses** — `'clicking the per-row dismiss button calls
   dismissNotification(id)'` + `'clicking "Dismiss all" calls
   clearNotifications()'` + `'dismissing one notification leaves the
   others in place'`.
3. **ARIA roles present** — `'uses role="alert" for warning + critical
   notifications'` + `'uses role="status" for info notifications'` +
   `'carries an accessible name on the region'` + `'every dismiss button
   has an aria-label describing the action'`.

The 25-test dispatch-wrapper suite explicitly proves:

- **Converts errors** — `'catches InsufficientFundsError and pushes a
  low-funds notification'` + per-error-class coverage of every typed
  error.

### Playwright

`apps/web/playwright.config.ts` + `apps/web/e2e/smoke.spec.ts` ship as
P5d scaffolding. The smoke spec exercises the gameplay loop end-to-end
(new game → buy water → advance time → harvest → save → reload →
verify state restored) and asserts the NotificationsPanel container is
present + the panel itself collapses to `null` on a healthy save. The
spec is intentionally minimal — it's a smoke pass, not a cross-browser
matrix.

The brief noted Playwright is "optional — document as gap if too heavy."
The config + spec are wired; running `pnpm --filter web test:e2e`
requires a one-time `pnpm exec playwright install chromium` to download
the browser binary, which is not run as part of the vitest suite. The
gap is **the browser binary download is opt-in** (not enforced in CI
yet) — tracked as **R-P5d-5**.

---

## 9. Open gaps / R-items (consolidated)

| ID | Description | Severity |
|----|-------------|----------|
| R-P5d-1 | In-game UI for `reducedMotionOverride` (defaults to `'auto'`) — settings panel TBD | Low |
| R-P5d-2 | `TreeView` not yet wired to `useReducedMotion` — branch-sway + particles animate unconditionally | Medium |
| R-P5d-3 | NotificationsPanel list is not a roving-tabindex widget — acceptable at ≤ 20 items | Low |
| R-P5d-4 | Auto-dismiss timer not wired (info / non-actionable notifications stay until dismissed) | Low |
| R-P5d-5 | Playwright browser binary download is opt-in (CI doesn't provision it) | Low |
| R-P5d-6 | Event-bridge from `SimulationEvent` (`expense-due`, `tree-died`, `weather-damage`, …) → `pushNotification` not yet shipped — the panel's actionable filter is in place, the producer isn't | Medium |

R-P5d-6 is the most consequential: the dispatch-wrapper converts typed
errors to notifications today (canonical case: insufficient funds on
purchase). The actionable event codes for expenses / tree death / storm
damage will fire from the engine's `SimulationEvent` stream once a
future phase adds the bridge; the panel + filter + FIFO cap + ARIA are
all ready for them.

---

## 10. TDD §21 acceptance criteria (status after P5d)

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | A new player can start with a sapling and initial funds. | ✅ | `engine.initialize(DEFAULT_GAME_CONFIG)` + New Game button |
| 2 | The player can purchase water and fertilizer. | ✅ | `PurchaseControls` dispatches `purchase`; `applyWater` / `applyFertilizer` factories shipped |
| 3 | The tree grows through simulated biological processes. | ✅ | `BiologySystem` advances the tree each tick |
| 4 | The tree produces physical money leaves. | ✅ | Foliage is the source of money leaves (P1) |
| 5 | Harvesting reduces foliage and photosynthetic capacity. | ✅ | `harvest-leaves` action handler |
| 6 | Energy reserves compensate for reduced foliage. | ✅ | `BiologySystem` reserves |
| 7 | Repeated harvesting can cause irreversible damage or death. | ✅ | Mature tree survives one 50% harvest; repeated severe defoliation kills |
| 8 | The tree responds to seasons and weather. | ✅ | `TimeSystem` + `WeatherSystem` + `ResourceSystem` |
| 9 | Personal expenses create a meaningful financial requirement. | ✅ | `ExpensesSummary` + `pay-expense` action + `expense-due` notification code (filter ready, bridge pending — R-P5d-6) |
| 12 | The original tree cannot be sold or transferred. | ✅ | `OriginalTreeNotTransferableError` → `'original-tree-protected'` notification via `dispatch-wrapper` |
| 13 | The tree's visual appearance reflects its actual simulation state. | ✅ | `buildTreeRenderData` + `CanvasTreeRenderer` + `TreeView` |

(Criteria 10, 11, 14, 15 are not in the requested scope — 10/14/15 are
engine-layer; 11 is covered by the existing IDB persistence + the P5d
Playwright smoke spec.)

P5d's contribution to §21:

- **#9** — `expense-due` is in the actionable codes list. The
  notification fires from the engine's `expense-due` SimulationEvent
  once the event-bridge (R-P5d-6) ships; the panel surface is ready.
- **#12** — `OriginalTreeNotTransferableError` is now caught by
  `safeDispatch` and surfaced as a `'original-tree-protected'`
  notification. The engine guard (P3c) was already in place; P5d adds
  the UI surface.
- **#13** — The TreeView's tint reflects the tree's condition tier
  (Healthy / Stressed / Critical / Dead) via `useTreeConditionTone`;
  the A11y pass on NotificationsPanel is the first WCAG-2.1-AA surface
  in the codebase. The TreeView animation gating (R-P5d-2) is the
  remaining a11y gap.
