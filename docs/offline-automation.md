# Offline Catch-up & Automation (P6 — final)

**Status:** Source-of-truth contract for the P6 Offline Progression + Automation
implementation (P6a–P6d). Built on `docs/GDD.txt` §4.2 (Offline Progression),
§9 (Automation and Technology), §9.1 (Environmental Impact), §95 pillar 4
(Automation Creates New Trade-offs), §17 (Unresolved Design Decisions); and
`docs/TDD.txt` §12 (Automation Engine), §14.4 (Offline Progression safeguards),
§18 (Testing Strategy).

P6 is the last phase before P7 (Persistence hardening) / P8 (Expansion). It
supersedes the P0 stubs in `packages/simulation/src/systems/stubs.ts` — the
`AutomationSystem` is now a real, pure, deterministic system (P6b2), the
offline catch-up processor is a pure function over `GameState` (P6a), and the
web app surfaces both via the `AutomationPanel` (P6d1) + `OfflineModal` (P6d2).
The remaining stubbed systems (Business, Progression, Event) stay stubbed
until P7+.

This document is paired with `docs/GDD.txt` and `docs/TDD.txt`. Where this
document and the GDD/TDD disagree, the GDD/TDD win and a fix must be filed
against this document.

> **Scope flag.** Every `@provisional` constant in this document corresponds to
> (or stands in for) an unresolved design decision listed in `GDD §17`. They
> live in `packages/shared/src/constants/offline.ts` + `economy.ts` (offline +
> automation tuning) and `apps/web/lib/constants.ts` (UI-side offline prompt
> threshold) under the `PROVISIONAL_OFFLINE_*` / `PROVISIONAL_AUTOMATION_*` /
> `PROVISIONAL_UI_OFFLINE_*` prefixes. P7+ playtesting will calibrate them;
> until then the engine NEVER hardcodes tuning numbers, only imports.

---

## 1. Public interfaces at a glance

| Surface                                        | Location                                                        | P6 phase |
|------------------------------------------------|-----------------------------------------------------------------|----------|
| `offline.ts` schemas — `OfflineSummary` + 2 events | `packages/shared/src/schemas/offline.ts`                    | P6a      |
| `errors.ts` — `OfflineClockTamperedError`       | `packages/shared/src/errors.ts`                                | P6a      |
| Offline constants (`PROVISIONAL_OFFLINE_*`)     | `packages/shared/src/constants/offline.ts`                     | P6a      |
| `catch-up.ts` — `runOfflineCatchUp` + `planOfflineCatchUp` | `packages/simulation/src/offline/catch-up.ts`        | P6a      |
| Automation schemas (`AutomationState`, `AutomationPolicy`, equipment) | `packages/shared/src/schemas/automation.ts` | P6b1     |
| Equipment content — 13 defs across 5 categories | `packages/content/src/equipment/`                              | P6b1     |
| Migration v7→v8 (automation array)              | `packages/shared/src/migrations/registry.ts`                   | P6b1     |
| `evaluate.ts` — `evaluatePolicy`                | `packages/simulation/src/automation/evaluate.ts`               | P6b2     |
| `execute.ts` — `executeAutomation`              | `packages/simulation/src/automation/execute.ts`                | P6b2     |
| `actions.ts` — 4 automation action handlers     | `packages/simulation/src/automation/actions.ts`                | P6b2     |
| `systems/automation.ts` — `AutomationSystem` (registry slot #9) | `packages/simulation/src/systems/automation.ts` | P6b2     |
| `offline-catch-up-trigger.ts` — `catchUpOnLoad` + `applyCatchUpOnLoad` | `apps/web/lib/persistence/offline-catch-up-trigger.ts` | P6d2 |
| `AutomationPanel` + sub-components               | `apps/web/components/automation/`                              | P6d1     |
| `OfflineModal` + `OfflineDeltaRow`              | `apps/web/components/offline/`                                 | P6d2     |
| UI prompt threshold (`PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS`) | `apps/web/lib/constants.ts`           | P6d2     |

The `engine.executeAction` dispatch table (`packages/simulation/src/actions/handlers.ts`)
registers these P6b2 actions:

| Action                  | Handler                    | P6 phase | Notes                                                        |
|-------------------------|----------------------------|---------|--------------------------------------------------------------|
| `purchase-equipment`    | `purchaseEquipmentHandler` | P6b2    | Debits `cost` from `player:personal` (sink to authority); appends an `AutomationState` derived from the `EquipmentDefinition`. Idempotent on `requestId`. |
| `enable-automation`     | `enableAutomationHandler`  | P6b2    | Flips `enabled = true`. Idempotent on an already-enabled automation. |
| `disable-automation`    | `disableAutomationHandler` | P6b2    | Flips `enabled = false` (pause without removing). Idempotent. |
| `set-automation-policy` | `setAutomationPolicyHandler` | P6b2  | Attaches/replaces the condition-based trigger. Content-gated by the equipment's `supportedPolicies` + `supportedActions`. |

The catch-up processor does NOT register an action — it is invoked directly
by `apps/web` on save load (see §2.4).

---

## 2. Offline catch-up (P6a — TDD §14.4, GDD §4.2)

### 2.1 Design rule: chunked `engine.advance`, NOT rate multiplication

GDD §4.2 is explicit: *"Offline progression must not simply multiply
production rates by elapsed time."* Multiplying rates would skip the
per-step event pipeline — no `tick` / `season-changed` / `harvest` /
`transaction` events would fire, biological thresholds (health → death) would
be crossed silently, and the EconomySystem's per-tick drain of
`pendingIssuances` would never run.

Instead the processor converts the elapsed real-world interval into
simulation seconds and runs `engine.advance(state, chunk)` per 1-sim-day
chunk. Every biological, environmental, and economic event fires through the
normal pipeline; the result is bit-identical to playing live for the same
elapsed sim time (splittability invariant, TDD §18.3 — tested in
`packages/simulation/test/offline-catch-up.test.ts`).

### 2.2 Real → sim conversion

```
simElapsedSeconds = floor((cappedRealMs / 1000) × PROVISIONAL_REAL_TO_SIM_SECONDS)
                  -- rounded DOWN to a multiple of PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS
```

`PROVISIONAL_REAL_TO_SIM_SECONDS = 60` (1 real second = 1 sim minute). This is
the SAME factor the live accumulator in `apps/web/hooks/useSimulationLoop.ts`
uses (`realDelta × 60 × speedMultiplier`), so being away for 1 real hour and
catching up advances the sim by the same amount as playing live at 1x for 1
real hour (216_000 sim sec → 2 chunks).

| Real interval | Sim seconds | Chunks (1 chunk = 86_400 sim s) |
|---------------|-------------|---------------------------------|
| 1 second      | 60          | 0 (sub-chunk remainder dropped) |
| 1 minute      | 3_600       | 0                               |
| 1 hour        | 216_000     | 2                               |
| 1 day         | 5_184_000   | 60                              |
| 30 days (cap) | 155_520_000 | 1_800                           |

### 2.3 Safeguards (TDD §14.4 step 4 + GDD §17)

- **Clock-tamper detection.** A backwards clock (`nowMs <
  state.metadata.lastSimulatedAt`) beyond
  `PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS` (1_000 ms) throws
  `OfflineClockTamperedError`. Small jitter within the tolerance is treated
  as zero elapsed (no chunks, empty summary). A backwards clock could mean
  manual clock-farming, a system restore, or an NTP step; the processor
  refuses rather than producing nonsense state. The state is NOT mutated by a
  failed catch-up — the consumer can still play from the loaded save.
- **Max interval cap.** The requested real interval is capped at
  `PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS` (30 real days). At factor 60 this
  is 1_800 1-sim-day chunks worst-case — bounded so the consumer's catch-up
  run stays finite. `summary.capped === true` records that the absence was
  only partially honoured so the UI warns the player.
- **Chunked execution.** Sim time is processed in 1-sim-day chunks
  (`PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS = 86_400`) so per-chunk event
  accumulation stays bounded (~O(100) events per chunk at the current system
  density). The chunk size MUST be a positive integer multiple of
  `PROVISIONAL_SIMULATION_STEP_SECONDS` (60) so `engine.advance` consumes the
  whole chunk with no remainder.
- **Purity.** The input `state` is NEVER mutated. A `deepCopy` is taken
  before any advancing (`engine.advance` also deep-copies on entry, so the
  input is doubly safe). All randomness flows through the seeded RNG
  reconstructed from `state.rngState`; there is no `Math.random()` /
  `Date.now()` inside the processor. The only external input is `nowMs`.

### 2.4 `OfflineSummary` shape + the two events

`OfflineSummary` (in `packages/shared/src/schemas/offline.ts`) is the typed
"while you were away" report — pure data the UI renders into a panel without
re-deriving from before/after snapshots:

```typescript
interface OfflineSummary {
  requestedRealMs: number;   // elapsed real ms asked to cover (after tolerance, before cap)
  cappedRealMs: number;      // ms actually simulated (after cap; == requestedRealMs unless capped)
  simElapsedSeconds: number; // total sim sec processed (chunksRun × chunkSimSeconds)
  chunksRun: number;         // number of engine.advance(chunk) calls
  capped: boolean;           // true if requested > cap
  clockTampered: boolean;    // always false on a returned summary (tamper throws)
  fromSimSeconds: number;    // pre-catch-up clock.elapsedSeconds
  toSimSeconds: number;      // post-catch-up clock.elapsedSeconds
  fromDay: number;           // pre-catch-up clock.day
  toDay: number;             // post-catch-up clock.day
  biological: {              // GDD §5.1 deltas — originalTree fields
    height, trunkDiameter, currentLeaves, energyReserves,
    waterStored, health, stress: OfflineSummaryDelta;  // { before, after, delta }
    alive: OfflineBooleanDelta;                        // { before, after }
  };
  economic: {                // TDD §10.4 deltas
    personalCash, monetarySupply, totalIssued: OfflineStringDelta; // bigint-as-string
    inflationIndex: OfflineSummaryDelta;
    transactionsCount: OfflineSummaryDelta;
  };
  environmental: {           // TDD §8.3 / GDD §10 deltas
    soilWater, freshwaterAvailability, biodiversityIndex,
    forestCoverage, globalTemperature, co2Concentration: OfflineSummaryDelta;
  };
}
```

The processor appends two bookend events to the result's `events` array
(they are NOT emitted by `engine.advance` — the engine is pure and
offline-agnostic; the processor appends them so consumers can see the catch-up
as a discrete operation in the event stream):

- `offline-catch-up-started` — at the pre-catch-up `clock.elapsedSeconds`;
  carries `{ requestedRealMs, simElapsedSecondsPlanned, chunksPlanned, capped }`
  so the UI can show a progress indicator while the processor runs.
- `offline-catch-up-completed` — at the post-catch-up `clock.elapsedSeconds`;
  carries the full `OfflineSummary` so the UI can render the modal directly
  from the event payload without reaching into state.

Both are only emitted when at least one chunk runs (a 0-chunk catch-up is a
silent no-op).

### 2.5 Public API

```typescript
// packages/simulation/src/offline/catch-up.ts

/** Plan without executing — for cap/threshold tests + "Catching up N days…" UI. */
export function planOfflineCatchUp(state: GameState, nowMs: number): OfflineCatchUpPlan;

/** Run the catch-up. Pure; throws OfflineClockTamperedError on a backwards clock. */
export function runOfflineCatchUp(state: GameState, nowMs: number): OfflineCatchUpResult;

interface OfflineCatchUpResult {
  readonly state: GameState;               // fresh state with lastSimulatedAt = nowMs
  readonly summary: OfflineSummary;
  readonly events: readonly SimulationEvent[]; // [started, ...chunkEvents, completed]
}
```

The processor is invoked by `apps/web`'s catch-up-on-load trigger
(`apps/web/lib/persistence/offline-catch-up-trigger.ts`), NOT by the engine
itself. The trigger gates the call on a staleness threshold
(`PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS`) and routes tampered-clock errors
to the notification bridge (see §4.1).

---

## 3. Automation (P6b/P6c — TDD §12, GDD §9)

### 3.1 `AutomationSystem` (registry slot #9)

`AutomationSystem` (`packages/simulation/src/systems/automation.ts`) replaces
the P0 stub at registry slot #9. It runs once per simulation step AFTER
`EconomySystem` (slot #6) and `PersonalSystem` (slot #7) — so
automation-triggered actions see the up-to-date economy + player state — and
BEFORE `EnvironmentSystem` (slot #10) so environmental impacts accumulated
here are visible to it.

Each step:

1. Fork a deterministic sub-stream `'AutomationSystem'` from `ctx.rng`
   (reserved for future stochastic failure modes like equipment breakdown;
   `@provisional` — not persisted on `rngStreams` because the schema has no
   `automation` slot).
2. For each automation in `state.automation` (in array order, over a snapshot
   so freshly-spawned automations don't fire this tick):
   a. `evaluatePolicy(state, automation, ctx.now, tickEvents)`.
   b. If `shouldRun`, `executeAutomation(state, automation, params)`.
      Otherwise emit `automation-skipped` with the reason.
   c. Accumulate the new state + events (each automation sees the effects of
      the ones before it this tick).

The system is pure: it deep-copies the input state, mutates the copy, and
returns the new state. The rendering layer MUST NOT execute automation
independently (TDD §12) — this system is the single engine-side driver; the
UI dispatches `enable/disable/set-policy/purchase-equipment` actions to
configure automations, but never runs them.

### 3.2 Policy types + evaluation

`AutomationPolicy` is a discriminated union on `kind`:

| Kind        | Condition                                          | When it fires                                               |
|-------------|----------------------------------------------------|-------------------------------------------------------------|
| `threshold` | `{ field, op, value }` — dotted path into state     | The field reading satisfies the op (`<`, `>`, `==`, `>=`, `<=`). Non-numeric / missing path → `condition-not-met`. |
| `event`     | `{ eventType }`                                     | The event type was emitted earlier this tick. `@provisional` — see §6.2. |
| `schedule`  | `{ kind: 'interval' \| 'at', value }`               | `interval`: on the cadence boundary AND `value` sec since last run. `at`: one-shot when `now >= value` and not yet fired. |

Evaluation order (mirrors the `automation-skipped` event `reason` enum):

1. `disabled` — `AutomationState.enabled === false`.
2. `cooldown` — `lastRunAt + cooldownSeconds > now` (prevents a persistently-
   true threshold from firing every tick).
3. `condition-not-met` — the policy's trigger did not match this tick.

If none apply, `shouldRun === true` and `executeAutomation` is called.
`insufficient-resources` is NOT an evaluation outcome — it is an *execution*
outcome; `executeAutomation` emits it (see §3.3).

Automations without a `policy` fall back to the P0 `schedule` (interval/at)
cadence — legacy interval-only automations keep working. When both are
present, the policy is authoritative for *when* to fire.

### 3.3 Execution + pillar-4 trade-offs

`executeAutomation(state, automation, params)` runs the automation's action
for the current tick (called by `AutomationSystem` ONLY when `evaluatePolicy`
returned `shouldRun: true`):

1. **Pre-check `resourceConsumption`** against `state.inventory`. If the
   player lacks the inputs, skip with reason `insufficient-resources` and do
   NOT advance `lastRunAt` (retries next tick when stock is replenished).
2. **Build + dispatch the `GameAction`** from `policy.action` +
   `policy.actionParams` via the normal `dispatch` pipeline — economy/resource
   invariants still hold because the action goes through the same handlers a
   player action would (TDD §12). If dispatch throws (e.g.
   `InsufficientFundsError`, `OriginalTreeNotTransferableError`), skip with
   reason `insufficient-resources`; `lastRunAt` is NOT advanced. The error is
   swallowed — automation failure must not crash the sim.
3. **Apply pillar-4 trade-offs (GDD §9.1, §95):**
   - `resourceConsumption` — deducted from `inventory.items` (floored at 0;
     the action it fed already moved the physical quantity, e.g.
     `apply-water` added water to soil).
   - `energyConsumption` — `@provisional`, no energy pool on
     `EnvironmentState` yet (P6+ will add one). Recorded in the
     `automation-triggered` event payload for audit; no state field debited.
   - `environmentalImpact` — pro-rated per tick (`impact × stepSeconds /
     86400`) and accumulated onto the closest existing `EnvironmentState`
     accumulators (`atmosphere.emissions`, `soil.contamination`,
     `soil.health`, `freshwater.availability`, `biodiversity.index`).
     `@provisional` field mapping — see §6.4.
   - `maintenanceCost` — pro-rated per tick (`cost × stepSeconds / 86400`,
     bigint floor division) and moved via `ledger.transfer` from
     `player:personal` to the virtual authority (a sink). The `requestId` is
     derived from `(saveId, simSecond, automationId)` so a re-processed tick
     does not double-charge (idempotency, TDD §10.3).
4. **Advance `lastRunAt = now`.**
5. **Emit `automation-triggered`** carrying the policy + the action type that ran.

### 3.4 The four action handlers

| Handler                    | Action                  | Effect |
|----------------------------|-------------------------|--------|
| `setAutomationPolicyHandler` | `set-automation-policy` | Replaces `policy` on the matching automation. Content-gated: if the equipment backing the automation resolves (via `automation.type = equipment.id`), the policy's `kind` must be in `supportedPolicies` and its `action` in `supportedActions` (`UnsupportedPolicyError`). |
| `enableAutomationHandler`  | `enable-automation`     | `enabled = true`. Idempotent on an already-enabled automation (no event). `UnknownAutomationError` for an unknown id. |
| `disableAutomationHandler` | `disable-automation`    | `enabled = false` (pause without removing). Idempotent. Retains policy + schedule + `lastRunAt` so re-enabling resumes the same configuration. |
| `purchaseEquipmentHandler` | `purchase-equipment`    | Resolves the equipment via `getEquipmentById` (`UnknownEquipmentError`). Debits `cost` from `player:personal` (sink to authority). Derives an `AutomationState` from the definition (energy/maintenance/environmental from the def; `resourceConsumption` empty — `@provisional`). Appends to `state.automation`. Emits `equipment-purchased`. Idempotent on `requestId`. |

Money NEVER silently created or destroyed (TDD §10.4): equipment purchases +
maintenance are `transfer()` calls with `destinationAccount = authority`
(a sink); `monetarySupply` decreases, `totalSinks` increases.

### 3.5 Equipment content — 13 definitions across 5 categories

`packages/content/src/equipment/` defines 13 `EquipmentDefinition`s across
GDD §9's five categories. Each is a pure data object — the
`purchase-equipment` handler looks one up to instantiate an
`AutomationState`; the rendering layer (`AutomationPanel`) lists them in the
shop grouped by category.

| Category      | Count | Equipment ids                                          | File           |
|---------------|-------|--------------------------------------------------------|----------------|
| irrigation    | 3     | `sprinkler-t1`, `sprinkler-t2`, `sprinkler-t3`          | `irrigation.ts` |
| fertilization | 3     | `spreader-t1`, `spreader-t2`, `spreader-t3`            | `fertilization.ts` |
| harvesting    | 3     | `harvester-t1`, `harvester-t2`, `harvester-t3`         | `harvesting.ts` |
| monitoring    | 2     | `soil-sensor`, `weather-station`                       | `monitoring.ts` |
| energy        | 2     | `solar-panel`, `battery`                               | `energy.ts`    |
| **Total**     | **13**|                                                        |                |

Each definition carries: `cost` (bigint minor), `baseEnergyConsumption`,
`baseMaintenanceCost`, `baseEnvironmentalImpact` (7 channels per GDD §9.1),
`supportedActions`, `supportedPolicies`, and optional `unlockRequirements`.
Higher tiers trade throughput / capability against higher cost + environmental
impact (the pillar-4 efficiency-vs-sustainability tension, GDD §9.1).

---

## 4. Automated harvesting pipeline (P6c — TDD §12 + §10.2)

The harvester equipment (`equipment:harvester-t1/t2/t3`) is the canonical
automation → economy bridge. A threshold policy on mature-leaf count (or an
event policy on a leaf-maturity event for tier 3) drives the full pipeline:

```
1. Harvester automation: policy.kind = threshold on originalTree.foliage.currentLeaves
2. AutomationSystem.evaluatePolicy → shouldRun (threshold met + cooldown elapsed)
3. AutomationSystem.executeAutomation → dispatch('harvest-leaves', { treeId, requestedLeaves })
   └─ via the normal action layer (NOT direct mutation — TDD §12)
4. harvest-leaves handler (packages/simulation/src/biology/harvest.ts)
   └─ reduces foliage.currentLeaves, emits a CurrencyIssuanceRequest
      queued on originalTree.pendingIssuances:
        { treeId, amount: bigint-string, currencyId, source: 'harvest-leaves' }
5. NEXT tick — EconomySystem (slot #6, runs BEFORE AutomationSystem slot #9)
   drains originalTree.pendingIssuances via the authority:
     └─ authority.processRequest → ledger.transfer from 'authority' to 'player:personal'
        (issuance increases monetarySupply + totalIssued; player.personalCash credited)
6. Player sees the credit on the next dashboard re-render.
```

### 4.1 Idempotency

Two layers prevent double-issuance / double-fire on replay (e.g. after a
save/load mid-pipeline):

- **Cooldown** (`automation.lastRunAt + automation.cooldownSeconds > now`) —
  `evaluatePolicy` returns `cooldown` and the automation does not re-fire
  within its window. Set per-equipment; the `purchase-equipment` handler
  seeds `cooldownSeconds = 0` (`@provisional` — tuning pending).
- **`processedRequestIds`** (TDD §10.3) — every `transfer()` carries a
  deterministic `requestId`. The maintenance path derives it from
  `(saveId, simSecond, automationId)`; the harvest path derives the
  issuance id from `(saveId, treeId, queue-position, simSecond)`. A replayed
  request is detected via `isRequestProcessed(state, requestId)` and skipped
  without double-charging / double-issuing.

### 4.2 P6c e2e coverage

`packages/simulation/test/` ships an automated-harvesting e2e test (P6c) that
runs a threshold-policy harvester across multiple ticks and asserts: the
harvest-leaves action fires when the threshold is met, a
`CurrencyIssuanceRequest` is queued, the next tick's EconomySystem drains it,
`player.personalCash` increases by the issued amount, and re-running the same
tick (determinism) produces bit-identical results.

---

## 5. UI (P6d — GDD §13.3 + §4.2)

### 5.1 `AutomationPanel` (P6d1)

`apps/web/components/automation/AutomationPanel.tsx` is the advanced-view
entry point (GDD §13.3). Two sections:

- **Equipment Shop** — lists every registered `EquipmentDefinition` grouped
  by category. Each item renders via `EquipmentCard`; the Purchase button
  dispatches `purchase-equipment` with `targetId = originalTree.id`.
  Affordability is pre-flighted via `getAffordableEquipment` (the engine
  re-checks at dispatch time).
- **Active Automations** — lists `state.automation` entries joined with their
  equipment via `getAutomationWithEquipment`. Each renders via
  `ActiveAutomationRow` (equipment name, target, enabled toggle, policy
  summary, last-run, cooldown, Configure Policy). Toggles dispatch
  `enable-automation` / `disable-automation`; the policy configurator
  dispatches `set-automation-policy`.

Rule 6 (TDD §15.1, GDD §6.1): the panel reads `state.automation` +
`state.player.personalCash` + `state.originalTree.id` + `state.clock` via
narrow Zustand selectors and dispatches actions only through
`useGameStore.getState().dispatch`. It NEVER runs simulation logic directly —
the `AutomationSystem` owns policy evaluation + execution (TDD §12: "rendering
layer should not execute automation independently").

### 5.2 `OfflineModal` (P6d2)

`apps/web/components/offline/OfflineModal.tsx` renders an `OfflineSummary`
parked on the UI slice (`ui.pendingOfflineSummary`) by the catch-up-on-load
trigger. Sections:

- **Header** — "While You Were Away" + the day range (`fromDay → toDay`),
  formatted as "Day 5 → Day 47" within one sim year or "Year 1 Day 5 →
  Year 2 Day 12" across a year boundary (`PROVISIONAL_DAYS_PER_YEAR = 120`).
- **Workload** — "Simulated X sim days in Y chunks" + a capped warning when
  `summary.capped === true` ("Your absence exceeded the 30-day cap; only the
  first 30 real days were simulated.").
- **Biological deltas** — height, trunkDiameter, currentLeaves, energyReserves,
  waterStored, health, stress (stress uses an inverted tone so a rise reads
  as bad). A special "Your tree died while you were away." line in red when
  `alive.before && !alive.after`.
- **Economic deltas** — personalCash, monetarySupply, inflationIndex,
  totalIssued (money-formatted), plus a transactionsCount summary
  ("X transactions recorded.").
- **Environmental deltas** — soilWater, freshwaterAvailability,
  biodiversityIndex, forestCoverage, globalTemperature, co2Concentration
  (temperature + CO₂ rising reads as bad).
- **Dismiss** — a "Continue" button that clears `pendingOfflineSummary` via
  the store's UI mutator (rule 6 — `simState` is referentially untouched;
  the catch-up already committed its state at load time).

`OfflineDeltaRow` (`apps/web/components/offline/OfflineDeltaRow.tsx`) is the
presentational before → after + delta-badge row. Pure; no store subscription.

The modal returns `null` when `pendingOfflineSummary === null` — the mount in
`apps/web/app/page.tsx` is a no-op most of the time.

### 5.3 Catch-up-on-load trigger

`apps/web/lib/persistence/offline-catch-up-trigger.ts` is the bridge between
the save-load flow (`useSimulationLoop`'s boot effect + `load()` callback) and
the P6a processor:

```typescript
// Pure core. Throws OfflineClockTamperedError on a backwards clock.
export function catchUpOnLoad(state: GameState, nowMs: number): CatchUpOnLoadResult;

// Side-effect wrapper the loop calls. Routes tampered-clock errors to the
// notification bridge via errorToNotification (lib/dispatch-wrapper.ts).
export function applyCatchUpOnLoad(
  state: GameState,
  nowMs: number,
  store: CatchUpOnLoadStore,
): CatchUpOnLoadResult;

interface CatchUpOnLoadResult {
  readonly state: GameState;               // fresh state when catch-up ran; input otherwise
  readonly summary: OfflineSummary | null; // non-null → modal renders; null → no modal
  readonly events: readonly SimulationEvent[];
}
```

Decision tree:

- `elapsed ≤ PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS` (60 real s) → fresh
  save; return input state unchanged with `summary: null`. The live rAF loop
  just resumes.
- `elapsed > threshold` → call `runOfflineCatchUp(state, nowMs)`.
  - `chunksRun > 0` → return `{ state, summary, events }`; the loop parks the
    summary on `ui.pendingOfflineSummary` → `OfflineModal` renders.
  - `chunksRun === 0` → the elapsed interval crossed the threshold but
    rounded to 0 sim chunks (e.g. 90 real s → 5_400 sim sec → 0 chunks).
    Return the processor's fresh state with `summary: null`; the state's
    `lastSimulatedAt` is advanced so the next load doesn't re-evaluate the
    same gap.
- Backwards clock beyond tolerance → `applyCatchUpOnLoad` catches
  `OfflineClockTamperedError`, calls `store.pushNotification(...)` with the
  `offline-clock-tampered` payload, and returns the original state unchanged
  (`summary: null`). The save is intact — only the catch-up was refused.

The split (pure `catchUpOnLoad` + side-effect `applyCatchUpOnLoad`) mirrors
the `dispatch` / `safeDispatch` split in `lib/dispatch-wrapper.ts`: the pure
core is unit-testable without a store; the wrapper is the thin layer that owns
the notification.

`useSimulationLoop` calls `applyCatchUpOnLoad(state, Date.now(),
useGameStore.getState())` in both its boot effect (after a save is loaded) and
its `load()` callback (after a manual Load). `newGame()` clears any parked
summary so a stale modal from a previous load doesn't linger.

---

## 6. Carry-forward / known gaps

P6b2 surfaced six `@provisional` TODOs that P7+ must resolve. They are
flagged in the source (`packages/simulation/src/systems/automation.ts`,
`automation/execute.ts`, `automation/actions.ts`) and listed here as the
carry-forward backlog:

### 6.1 Event-triggered policies need `SystemContext` extension

`AutomationSystem` cannot observe what other systems emitted this tick —
`SystemContext` has no `events` field, so the system passes an empty
`tickEvents` array and `event` policies always evaluate to
`condition-not-met`. Wiring this requires extending `SystemContext` (or having
the engine thread in-step events through to systems), which touches the engine
+ system interface — out of P6b2 scope.

### 6.2 RNG sub-stream persistence

The `AutomationSystem` forks a deterministic sub-stream `'AutomationSystem'`
from `ctx.rng` each step. The fork is stateless per-step (like
`BiologySystem`'s fork) because the schema has no `rngStreams.automation`
slot. Persisting it would need a schema field + migration — `@provisional`
(GDD §17). Reserved for future stochastic failure modes (equipment
breakdown rolls); the deterministic execution path does not draw from it yet.

### 6.3 Energy pool pending `EnvironmentSystem`

`AutomationState.energyConsumption` is recorded in the `automation-triggered`
event payload for audit but no state field is debited — there is no energy
pool on `EnvironmentState` yet. P6+ will add one (the `energy` equipment
category — `solar-panel`, `battery` — is already defined in content). Until
then, energy consumption is a reported-but-unenforced trade-off.

### 6.4 Environmental impact field mapping

GDD §9.1 lists seven impact channels (electricity, fossil fuel, manufacturing
emissions, resource extraction, land disruption, chemical pollution, water
consumption); the current `EnvironmentState` exposes fewer accumulators. The
mapping in `execute.ts` routes each channel to the closest existing field
(`carbonEmissions → atmosphere.emissions`, `waterConsumption →
freshwater.availability`, `pollution → soil.contamination`, `soilDegradation
→ soil.health`, `biodiversityImpact → biodiversity.index`). `landDisturbance`
has no current target (a `landUse` field is a P6+ addition) and is recorded
in the event payload only.

### 6.5 Maintenance fractional rounding

Per-tick maintenance is `dailyCost × stepSeconds / 86400` using bigint floor
division. Small daily costs that round down to 0 per tick skip the transfer
(`validateAmount` rejects 0-amount transfers) — they accrue only at the daily
boundary in the current model. A fractional accumulator would smooth this, but
no schema field exists yet. Similarly, if the player cannot afford
maintenance, the automation runs "unmaintained" this tick (the action already
executed); a future maintenance-debt ledger would accrue the shortfall.

### 6.6 `resourceConsumption` derivation at purchase

The `purchase-equipment` handler seeds `resourceConsumption: []` for every
freshly-purchased automation. The intent is to derive it from the equipment's
`supportedActions` (e.g. irrigation → `resource:water`) in a future phase.
Until then, automations that feed a resource-consuming action (e.g.
`apply-water`) do not pre-check inventory for the water itself — the action
handler still gates on the soil water pool. Empty for now.

---

## 7. @provisional constants (GDD §17 pointers)

| Constant                                                  | Value        | Location                                          | GDD §17 item |
|-----------------------------------------------------------|--------------|---------------------------------------------------|--------------|
| `PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS`                | 30 real days | `packages/shared/src/constants/offline.ts`        | Offline Progression safeguards (TDD §14.4 step 4) |
| `PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS`                   | 86_400 (1 sim day) | `packages/shared/src/constants/offline.ts`  | Offline Progression must not multiply production rates |
| `PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS`        | 1_000 ms     | `packages/shared/src/constants/offline.ts`        | Safeguards against unreasonable system clock changes |
| `PROVISIONAL_OFFLINE_DIVERGENCE_TOLERANCE`                | 1e-9         | `packages/shared/src/constants/offline.ts`        | Splittability invariant safety margin |
| `PROVISIONAL_REAL_TO_SIM_SECONDS`                         | 60           | `packages/shared/src/constants/provisional.ts`    | Real → sim conversion factor (shared with live loop) |
| `PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS`                 | 60_000 ms    | `apps/web/lib/constants.ts`                       | Offline prompt threshold (P6d2) |
| `PROVISIONAL_DAYS_PER_YEAR`                               | 120          | `packages/shared/src/constants/provisional.ts`    | Calendar length (offline day-range formatter) |
| Equipment `cost` / `baseEnergyConsumption` / `baseMaintenanceCost` / `baseEnvironmentalImpact` | per-def | `packages/content/src/equipment/` | "automation cost/effectiveness balance" + "detailed resource simulation equations" |
| Automation `cooldownSeconds` (seeded 0 at purchase)       | 0            | `packages/simulation/src/automation/actions.ts`   | Cooldown / threshold tuning |
| `DEFAULT_PURCHASE_SCHEDULE` (interval 1 sim day)          | 86_400       | `packages/simulation/src/automation/actions.ts`   | Default cadence tuning |

When a value is promoted from "provisional" to "decided" via playtesting,
move it to a sibling `decided.ts` and drop the `PROVISIONAL_` prefix (matching
the convention in `packages/shared/src/constants/`).

---

## 8. Public interfaces (signatures)

### 8.1 Offline catch-up

```typescript
// packages/simulation/src/offline/catch-up.ts
export function planOfflineCatchUp(state: GameState, nowMs: number): OfflineCatchUpPlan;
export function runOfflineCatchUp(state: GameState, nowMs: number): OfflineCatchUpResult;

// apps/web/lib/persistence/offline-catch-up-trigger.ts
export function catchUpOnLoad(state: GameState, nowMs: number): CatchUpOnLoadResult;
export function applyCatchUpOnLoad(
  state: GameState,
  nowMs: number,
  store: CatchUpOnLoadStore,
): CatchUpOnLoadResult;
```

### 8.2 AutomationSystem

```typescript
// packages/simulation/src/systems/automation.ts
export const automationSystem: System;  // registry slot #9

// packages/simulation/src/automation/evaluate.ts
export function evaluatePolicy(
  state: GameState,
  automation: AutomationState,
  now: number,
  tickEvents?: readonly string[],
): EvaluateResult;  // { shouldRun: boolean; reason?: SkipReason }

// packages/simulation/src/automation/execute.ts
export function executeAutomation(
  state: GameState,
  automation: AutomationState,
  params: ExecuteAutomationParams,  // { now, stepSeconds, rng }
): SystemResult;  // { state, events }
```

### 8.3 Action handler signatures

```typescript
// packages/simulation/src/automation/actions.ts
export const setAutomationPolicyHandler: ActionListener<SetAutomationPolicyAction>;
export const enableAutomationHandler:     ActionListener<EnableAutomationAction>;
export const disableAutomationHandler:    ActionListener<DisableAutomationAction>;
export const purchaseEquipmentHandler:    ActionListener<PurchaseEquipmentAction>;
```

### 8.4 UI

```typescript
// apps/web/components/automation/AutomationPanel.tsx
export function AutomationPanel(props?: AutomationPanelProps): ReactElement | null;

// apps/web/components/offline/OfflineModal.tsx
export function OfflineModal(props?: OfflineModalProps): ReactElement | null;

// apps/web/stores/game-store.ts (P6d2 UI mutators)
setPendingOfflineSummary(summary: OfflineSummary): void;
clearPendingOfflineSummary(): void;
selectPendingOfflineSummary(state: GameStoreState): OfflineSummary | null;
```
