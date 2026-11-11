# Simulation Architecture (P0 Foundation)

**Status:** Source-of-truth contract for Phase 1–3 agents. P0 implements TDD Milestone 1 (Foundation).

This document describes the simulation engine, its data model, the runtime invariants every downstream agent MUST preserve, and the extension recipes for adding new Systems, Actions, Events, and content in later phases.

It is paired with the design documents (`docs/GDD.txt`, `docs/TDD.txt`). Where this document and the GDD/TDD disagree, the GDD/TDD win and a fix must be filed against this document.

---

## 1. Monorepo layout

```text
capitalist-tree/
├── apps/
│   └── web/                       # Next.js app — the ONLY presentation layer
│       ├── app/                   # Next.js App Router pages
│       ├── lib/
│       │   ├── use-engine-game.ts # Consumer-side accumulator (TDD §6.3)
│       │   └── persistence/       # IndexedDB Storage implementation
│       └── ...
├── packages/
│   ├── simulation/                # Pure simulation engine
│   │   ├── src/
│   │   │   ├── simulation.ts      # SimulationEngine: initialize / advance / executeAction
│   │   │   ├── initial-state.ts   # initializeState(config) factory
│   │   │   ├── rng.ts             # sfc32 + splitmix32 seeded RNG
│   │   │   ├── deep-copy.ts       # structuredClone-based defensive copy
│   │   │   ├── systems/           # System interface + registry + TimeSystem + 11 stubs
│   │   │   ├── events/            # Scheduler (priority queue keyed by sim seconds)
│   │   │   ├── actions/           # GameAction handlers (no-op, set-speed)
│   │   │   └── persistence/       # Storage interface + InMemoryStorage
│   │   └── test/                  # 43 tests
│   ├── shared/                    # Schemas, constants, migrations, serialization
│   │   ├── src/
│   │   │   ├── schemas/           # Zod schemas (GameState + sub-schemas)
│   │   │   ├── constants/         # PROVISIONAL_* constants (GDD §17)
│   │   │   ├── migrations/        # MigrationRegistry + sample v0 → v1
│   │   │   ├── serialization/     # serialize / deserialize (migrate-then-validate)
│   │   │   └── errors.ts          # Typed error classes
│   │   └── test/                  # 21 tests
│   ├── content/                   # STUB. P2/P3/P5/P8+ will populate
│   │   └── src/{species,fertilizers,equipment,weather,upgrades}/
│   └── rendering/                 # STUB. P4 will populate
├── docs/
│   ├── GDD.txt                    # Game design — the WHAT
│   ├── TDD.txt                    # Technical design — the HOW
│   └── simulation.md              # ← this file — the ENGINE CONTRACT
├── package.json                   # Workspace root scripts
├── tsconfig.base.json             # strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess
├── vitest.config.ts               # Test runner
└── eslint.config.mjs              # Lint config (TS + prettier compat)
```

### Architectural rule (TDD §3)

`packages/simulation` MUST NOT import from `apps/web`, `next`, `react`, `react-dom`, `@reduxjs/*`, or `idb`. The web app consumes simulation functionality, but the simulation must not know that a web application exists.

This is enforced by the test at `packages/simulation/test/import-boundary.test.ts`, which scans every `.ts` file under `packages/simulation/src/` and fails on any forbidden import statement. Comments and JSDoc mentioning those names are allowed (the regex matches `import ... from '...'` statements only).

### TypeScript strictness

`tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noFallthroughCasesInSwitch`. Downstream agents MUST NOT relax these — they are how we catch null/undefined bugs at compile time.

---

## 2. The SimulationEngine interface

Location: `packages/simulation/src/simulation.ts`.

```typescript
export interface SimulationResult {
  /** New game state — the input is NEVER mutated. */
  readonly state: GameState;
  /** Events emitted during this call (tick, season-changed, scheduled-event, etc.). */
  readonly events: readonly SimulationEvent[];
  /** Seconds actually consumed (always a multiple of PROVISIONAL_SIMULATION_STEP_SECONDS). */
  readonly consumedSeconds: number;
}

export interface SimulationEngine {
  initialize(config: GameConfig): GameState;
  advance(state: GameState, elapsedSeconds: number): SimulationResult;
  executeAction(state: GameState, action: GameAction): SimulationResult;
}

export const engine: SimulationEngine;
```

### Purity contract (TDD §4.1, rule 2)

- `advance` and `executeAction` deep-copy the input state on entry via `structuredClone` (with a JSON fallback) — they NEVER mutate the input.
- All randomness flows through `Rng.fromState(state.rngState)`. No `Math.random()`, no `Date.now()` inside `advance`.
- The RNG position is persisted in the returned state so the next call picks up where this one left off (determinism across calls + save/load).

### Fixed timestep (TDD §6.2/6.3)

```typescript
const STEP = PROVISIONAL_SIMULATION_STEP_SECONDS; // 60 sim seconds = 1 in-game minute
```

`advance(state, elapsedSeconds)` breaks `elapsedSeconds` into `floor(elapsedSeconds / STEP)` whole steps. Any sub-step remainder is dropped at this layer — the consumer (`apps/web/lib/use-engine-game.ts`) tracks the remainder in an accumulator. Each step:

1. Rebuild `Rng` from `state.rngState`.
2. Build `SystemContext { now, stepSeconds, dayOfYear, rng }`.
3. Run every system in `defaultRegistry.all()` in registry order.
4. Fire any scheduled events whose `at <= state.clock.elapsedSeconds` (scheduler).
5. Persist the new RNG state onto the returned state.
6. Append all emitted events.

### Pause contract

`engine.advance` does NOT short-circuit on `clock.paused`. The accumulator in `apps/web` is responsible for not calling `advance` while paused. This keeps the engine pure and makes pause purely a UI concern.

The accumulator (`apps/web/lib/use-engine-game.ts`):

```typescript
if (!current.clock.paused && current.clock.speedMultiplier > 0) {
  accumulator += realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS * current.clock.speedMultiplier;
  if (accumulator >= 1) {
    const result = engine.advance(stateRef.current, accumulator);
    accumulator -= result.consumedSeconds;
    stateRef.current = result.state;
    setState(result.state);
    appendEvents(result.events);
  }
}
```

### Splittability (determinism across split calls)

For any `X, Y` that are multiples of `PROVISIONAL_SIMULATION_STEP_SECONDS`:

```text
advance(advance(s, X).state, Y)  deepEquals  advance(s, X + Y)
```

in both `state` and `events`. This is verified by `packages/simulation/test/engine.test.ts`. When `X` or `Y` is NOT a multiple of the step, the remainder is dropped, so splittability holds only for whole-step inputs. Downstream agents that need sub-step precision must handle the accumulator themselves.

---

## 3. The System interface

Location: `packages/simulation/src/systems/system.ts`.

```typescript
export interface SystemContext {
  /** Current simulation time (clock.elapsedSeconds) for this step. */
  readonly now: number;
  /** Length of this step in simulation seconds (= PROVISIONAL_SIMULATION_STEP_SECONDS). */
  readonly stepSeconds: number;
  /** Total in-game day counter since game start (NOT day-of-year). */
  readonly dayOfYear: number;
  /** Root RNG. Systems should `fork(name)` for their own sub-stream. */
  readonly rng: Rng;
}

export interface SystemResult {
  readonly state: GameState;
  readonly events: readonly SimulationEvent[];
}

export interface System {
  readonly id: string;
  execute(state: GameState, ctx: SystemContext): SystemResult;
}

/** Helper for stub systems: returns state unchanged and emits no events. */
export function noopSystem(id: string): System;
```

### How to implement a System (P1+)

```typescript
import type { System, SystemContext, SystemResult } from './system.js';
import { deepCopy } from '../deep-copy.js';

export const mySystem: System = {
  id: 'MySystem',
  execute(state, ctx): SystemResult {
    const next = deepCopy(state);  // never mutate input
    const rng = ctx.rng.fork('MySystem');  // deterministic sub-stream

    // ...mutate `next` based on `ctx.now`, `ctx.stepSeconds`, `rng`...

    return {
      state: next,
      events: [
        { type: 'system', at: ctx.now, payload: { systemId: 'MySystem', message: '...' } },
      ],
    };
  },
};
```

Then register it in `packages/simulation/src/systems/index.ts` (see §4 below).

### System execution order (STABLE — do NOT reorder existing entries)

The order mirrors TDD §4.2's table and is part of the determinism contract (TDD §18.3). Do NOT reorder existing entries when adding new systems — append or insert deliberately and document why in the registry source.

```text
 1. TimeSystem        — advance the clock first; everyone reads new time.   [REAL]
 2. WeatherSystem     — produces weather other systems react to.            [REAL]
 3. BiologySystem     — photosynthesis/growth; depends on weather + time.   [REAL]
 4. ResourceSystem    — water/nutrients/soil; depends on weather + biology. [REAL]
 5. HarvestSystem     — leaf removal; depends on biology.                   [REAL]
 6. EconomySystem     — money/transactions; depends on harvest output.     [REAL]
 7. PersonalSystem    — expenses/well-being; depends on economy.            [REAL]
 8. BusinessSystem    — business operations; depends on economy.             [STUB]
 9. AutomationSystem  — automated actions; depends on resources/economy.   [STUB]
10. EnvironmentSystem — aggregates environmental impacts.                   [STUB]
11. ProgressionSystem — research/achievements; depends on everything.       [STUB]
12. EventSystem       — scheduled events; runs last so it sees the
                        fully-updated state for the step.                   [STUB]
```

**Real-system status (post-P3c):** TimeSystem (P0), WeatherSystem (P2),
BiologySystem (P1), ResourceSystem (P2), HarvestSystem (P1), EconomySystem
(P3a/P3b — drains `pendingIssuances`, recomputes market prices + inflation
index, see `docs/economy.md`), PersonalSystem (P3c — scheduled expenses,
well-being derivation, low-funds notifications, see `docs/economy.md`).
The remaining six systems are stubs (`noopSystem` from `systems/system.ts`).

The scheduler is invoked by the engine AFTER all systems run (it's not a system itself) — see `packages/simulation/src/simulation.ts`.

---

## 4. The SystemRegistry

Location: `packages/simulation/src/systems/registry.ts`.

```typescript
export class SystemRegistry {
  constructor(systems: readonly System[]);
  all(): readonly System[];
  ids(): readonly string[];
}

export const defaultRegistry: SystemRegistry;  // holds the 12 systems above in order
```

When replacing a stub with a real implementation (P1+), swap the export in `packages/simulation/src/systems/index.ts`:

```typescript
// Was:
import { weatherSystem } from './stubs.js';
// Becomes:
import { weatherSystem } from './weather-system.js';  // P2 adds this file
```

Keep the registry order unchanged.

---

## 5. GameState schema

Location: `packages/shared/src/schemas/game-state.ts`. Faithful to TDD §5.1, with two P0 additions documented below.

```typescript
export const gameStateSchema = z
  .object({
    metadata: gameMetadataSchema,       // §5.2 below
    clock: simulationClockSchema,       // §5.3
    player: playerStateSchema,         // §5.4
    originalTree: treeStateSchema,     // §5.5 — separate top-level field
    world: worldStateSchema,           // §5.6
    economy: economyStateSchema,      // §5.7
    businesses: z.array(businessStateSchema),
    inventory: inventoryStateSchema,
    automation: z.array(automationStateSchema),
    progression: progressionStateSchema,
    history: historicalStateSchema,
    // P0 additions beyond TDD §5.1:
    rngState: rngStateSchema,          // serializable RNG position (determinism)
    scheduler: schedulerStateSchema,   // serializable event scheduler (TDD §6.4)
  })
  .superRefine((s, ctx) => {
    // GDD §16.1/16.2 + TDD §18.4 — original tree cannot be sold or replaced.
    if (s.originalTree.isOriginal !== true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom,
        path: ['originalTree', 'isOriginal'],
        message: 'originalTree.isOriginal MUST be true (GDD §16.1/16.2).' });
    }
    if (s.originalTree.id !== 'original') {
      ctx.addIssue({ code: z.ZodIssueCode.custom,
        path: ['originalTree', 'id'],
        message: "originalTree.id MUST be 'original' (GDD §16.1/16.2)." });
    }
  });

export type GameState = z.infer<typeof gameStateSchema>;
```

### 5.1 Why `originalTree` is a separate top-level field

TDD §5.1:

> The original tree is explicitly separated from additional trees. This reinforces its special status and prevents accidental treatment as an ordinary business asset.

The `superRefine` enforces GDD §16.1 (cannot be sold) and §16.2 (cannot be replaced) at the schema layer: any save that tries to set `originalTree.isOriginal = false` or `originalTree.id = 'something-else'` is rejected before it can be loaded.

A full action-layer guard (preventing UI actions like "sell originalTree") is P3's responsibility — but the schema guarantees that even a buggy action cannot persist a corrupted original tree.

### 5.2 GameMetadata (`metadata`)

```typescript
{
  saveId: string;            // unique per save
  version: number;           // engine version (separate from save schemaVersion)
  createdAt: number;        // Unix ms — read from Date.now() ONCE at game creation
  lastSavedAt: number;       // Unix ms
  lastSimulatedAt: number;   // Unix ms
  randomSeed: number;        // The seed used to construct the RNG (for full re-derivation)
  simulationVersion: number; // bumped when engine behaviour changes
}
```

The RNG's live state is persisted separately on `GameState.rngState`; `randomSeed` is for full re-derivation if you ever need to reconstruct from scratch.

### 5.3 SimulationClock (`clock`)

```typescript
{
  elapsedSeconds: number;    // monotonic integer multiple of SIMULATION_STEP_SECONDS
  day: number;               // total in-game days since start
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  timeOfDay: number;         // fraction in [0, 1). 0=midnight, 0.25=06:00, 0.5=noon
  speedMultiplier: number;   // 0 | 1 | 5 | 15 | 60 (PROVISIONAL_SPEED_MULTIPLIERS)
  paused: boolean;            // accumulator layer enforces this; engine itself ignores it
}
```

### 5.4 PlayerState (`player`)

All monetary fields are bigint minor units serialized as strings (TDD §10.1, GDD §6). `health`, `happiness`, `financialSecurity` are derived indicators in [0, 1] — P3's PersonalSystem will recompute them from underlying drivers. P0 leaves them at neutral defaults.

### 5.5 TreeState (`originalTree`)

See `packages/shared/src/schemas/tree.ts`. `health` is a derived indicator (GDD §5.1) — stored on the tree so consumers can read it, but it MUST be recomputed by BiologySystem from underlying biological factors. P0 leaves it at `1`.

`ageDays` MUST be `>= 0` (validated by the schema). `originalTree.id` MUST be `'original'` and `originalTree.isOriginal` MUST be `true` (enforced by superRefine).

### 5.6 WorldState (`world`)

```typescript
{
  environment: EnvironmentState;  // global atmosphere/soil/water/biodiversity/etc.
  regionId: string;               // PROVISIONAL: P6/P9 expand into a region map
}
```

### 5.7 EconomyState (`economy`)

All monetary amounts are bigint minor units serialized as strings. P0 initializes an empty transaction log and a single starting market for the default currency; later phases populate markets and authority policy.

```typescript
{
  monetarySupply: string;     // bigint-as-string
  inflationRate: number;      // annual fraction (P0: 0)
  interestRate: number;       // annual fraction (P0: 0)
  monetaryAuthority: { monetarySupply, interestRate, inflationTarget };
  markets: MarketState[];
  transactions: TransactionRecord[];
}
```

### 5.8 P0 additions

- `rngState: [number, number, number, number]` — serializable RNG position so determinism survives save/load (TDD §18.3). See §6 below.
- `scheduler: { events: ScheduledEvent[] }` — serializable event scheduler (TDD §6.4). See §7 below.

---

## 6. The RNG and its serialization

Location: `packages/simulation/src/rng.ts`. sfc32 + splitmix32 seeder.

```typescript
export type RngState = [number, number, number, number];

export class Rng {
  static fromSeed(seed: number): Rng;          // splitmix32 expands to 4 words + 16-iter warmup
  static fromState(state: RngState): Rng;      // identity-preserving reconstruction

  next(): number;                              // float in [0, 1)
  nextInt(min: number, max: number): number;    // inclusive [min, max]
  getState(): RngState;                         // serializable snapshot

  /**
   * Fork a sub-stream for a named consumer.
   * - Child's sequence is INDEPENDENT of the parent's subsequent draws.
   * - Same (parentState, name) pair always yields the same child sequence.
   * - The parent advances by exactly one draw to seed the fork.
   *
   * Use this to give each system its own deterministic sub-stream so a
   * system's draws don't shift other systems' sequences:
   *
   *   const weatherRng = rng.fork('weather');
   */
  fork(name: string): Rng;
}
```

### Serialization

The RNG's live state is persisted on `GameState.rngState` as a fixed-length 4-tuple of 32-bit unsigned integers:

```typescript
// packages/shared/src/schemas/rng.ts
export const rngStateSchema = z.tuple([
  z.number().int().min(0).max(0xffffffff),
  z.number().int().min(0).max(0xffffffff),
  z.number().int().min(0).max(0xffffffff),
  z.number().int().min(0).max(0xffffffff),
]);
```

### Determinism contract (TDD §18.3)

- `Rng.fromSeed(s)` always produces the same sequence.
- `getState()` + `Rng.fromState(state)` is identity-preserving: the next draw after a save/load equals the next draw had there been no save/load. Verified by `packages/simulation/test/rng.test.ts`.
- `fork('a')` and `fork('b')` produce independent sequences. Verified by `packages/simulation/test/rng.test.ts`.

### IMPORTANT for systems that fork

If a system needs its sub-stream to survive save/load, it MUST persist the child's state itself (e.g. on a sub-field of GameState). The root RNG on `GameState.rngState` is shared by default — forks are derived fresh from the root each step, which is fine for stateless per-step draws but NOT for stateful per-system RNG (where you want the child's position to advance across saves).

---

## 7. The Event Scheduler

Location: `packages/simulation/src/events/scheduler.ts`. A serializable priority queue keyed by simulation time (`at`, in sim seconds). Events fire when `clock.elapsedSeconds >= at`.

```typescript
export function schedule(state: GameState, event: ScheduledEvent): GameState;
export function due(state: GameState, now: number): { fired: ScheduledEvent[]; state: GameState };
export function cancel(state: GameState, eventId: string): GameState;
```

All three are pure — they return new state, never mutate. The scheduler is invoked by the engine AFTER all systems run, once per simulation step. Each fired scheduled event becomes a `scheduled-event` SimulationEvent in the result.

### ScheduledEvent payload kinds

Defined in `packages/shared/src/schemas/scheduler.ts`:

```typescript
type ScheduledEventKind =
  | 'season-transition'
  | 'bill-due'
  | 'loan-payment'
  | 'maintenance'
  | 'market-review'
  | 'scheduled-harvest'
  | 'custom';        // reserved for future kinds — kept open to avoid churn
```

P2/P3/P5 will populate concrete payload shapes per kind. P0 stubs them as opaque `z.unknown()`.

---

## 8. SimulationEvent discriminated union

Location: `packages/shared/src/schemas/events.ts`.

```typescript
type SimulationEvent =
  | { type: 'tick';              at: number; payload: { step, day, timeOfDay } }
  | { type: 'season-changed';    at: number; payload: { from: string, to: string, day } }
  | { type: 'weather-changed';    at: number; payload: { from: string | null, to: string } }
  | { type: 'scheduled-event';   at: number; payload: { eventId, kind, data: unknown } }
  | { type: 'notification';      at: number; payload: { severity: 'info'|'warning'|'critical', message, code } }
  | { type: 'system';            at: number; payload: { systemId, message, data?: unknown } };
```

### How to extend (P1/P2/P3/...)

Add a new variant with a unique `type` literal. Do NOT loosen the union with a catch-all. Consumers switch on `event.type` and TypeScript's exhaustiveness check will catch missing cases.

```typescript
// packages/shared/src/schemas/events.ts
export const myEventSchema = z.object({
  type: z.literal('my-event'),
  at: z.number().int().nonnegative(),
  payload: z.object({ /* ... */ }),
});

export const simulationEventSchema = z.discriminatedUnion('type', [
  // ...existing variants...
  myEventSchema,
]);
```

---

## 9. GameAction discriminated union

Location: `packages/shared/src/schemas/actions.ts`.

```typescript
type GameAction =
  | { type: 'no-op' }
  | { type: 'set-speed'; payload: { multiplier: number } };
```

`set-speed.multiplier` MUST be one of `PROVISIONAL_SPEED_MULTIPLIERS = [0, 1, 5, 15, 60]`.

### How to add a new action (P1/P3)

1. Add a new variant to `gameActionSchema` in `packages/shared/src/schemas/actions.ts`.
2. Add a handler function in `packages/simulation/src/actions/handlers.ts`.
3. Register the handler in the `actionHandlers` map.
4. `executeAction` automatically routes by `action.type`.

Unknown action types raise `UnknownActionError` (defined in `packages/shared/src/errors.ts`) — verified by `packages/simulation/test/engine.test.ts`.

```typescript
// Handler signature:
export type ActionListener<A extends GameAction = GameAction> = (
  state: GameState,
  action: A,
) => SystemResult;  // { state, events }

// Registration:
export const actionHandlers: Record<string, ActionListener> = {
  'no-op': noOp,
  'set-speed': setSpeed as ActionListener,
};
```

---

## 10. Migration framework

Location: `packages/shared/src/migrations/registry.ts`.

```typescript
export type Migration = (state: GameState) => GameState;

export class MigrationRegistry {
  register(fromVersion: number, migration: Migration): this;
  knownVersions(): number[];
  migrate(state: GameState, fromVersion: number, targetVersion: number): GameState;
}

export const migrations: MigrationRegistry;  // default registry, v0 → v1 registered
```

### Behavior

- `fromVersion === targetVersion` → returns state unchanged (identity).
- `fromVersion > targetVersion` → raises `UnknownSchemaVersionError` (downgrades not supported).
- Missing intermediate migration → raises `UnknownSchemaVersionError`.
- **NEVER silently discards a save** (TDD §14.3).

### Current registered migrations

`packages/shared/src/migrations/defaults.ts` registers one sample migration v0 → v1 that backfills an empty `scheduler` field if missing. This is exercised by tests but no real v0 saves exist in production.

### How to add a real migration (any future agent)

1. Bump `CURRENT_SCHEMA_VERSION` in `packages/shared/src/constants/provisional.ts`.
2. Add a `Migration` function in `packages/shared/src/migrations/defaults.ts` that transforms the previous version's shape into the new one.
3. Register it via `migrations.register(prevVersion, myMigration)`.
4. Migrations MUST be pure and MUST NOT touch `originalTree.id` or `originalTree.isOriginal` (GDD §16.1/16.2).

---

## 11. The Storage interface

Location: `packages/simulation/src/persistence/storage.ts`.

```typescript
export interface Storage {
  save(state: GameState): Promise<string>;
  load(): Promise<GameState | null>;
  listSaves(): Promise<readonly string[]>;
  deleteSave(id: string): Promise<boolean>;
  /** Validate a raw save object — runs migrations + Zod validation. */
  validate(raw: unknown): GameState;
}

export class InMemoryStorage implements Storage;  // for tests
// apps/web/lib/persistence/indexed-db-storage.ts → IndexedDbStorage (browser)
```

### Load path (the part that runs migrations)

```text
Storage.load()
  → Storage.validate(rawEnv)
      → assertKnownSchemaVersion(env.schemaVersion)  // throws UnknownSchemaVersionError for unknown versions
      → deserialize(env)                              // see below
```

`deserialize()` (in `packages/shared/src/serialization/index.ts`) runs in three steps — the order is critical:

```text
1. Parse envelope shape loosely (only schemaVersion + state-as-unknown).
   We do NOT validate state internals here — older saves whose state
   doesn't match the current schema would be rejected before migrations
   could fix them (TDD §14.3).

2. Run migrations.migrate(state, schemaVersion, CURRENT_SCHEMA_VERSION).
   Throws UnknownSchemaVersionError for unknown versions.

3. Strictly validate the migrated state against gameStateSchema
   (including the originalTree superRefine invariants).
   Throws SaveValidationError on failure.
```

If you change the GameState shape, you MUST register a migration (§10). Otherwise existing player saves will fail at step 3 and the game cannot recover them.

---

## 12. Provisional constants

Location: `packages/shared/src/constants/provisional.ts`.

Every value in this file corresponds to (or stands in for) an unresolved design decision listed in GDD §17. They live in a single file so they can be tuned in one place during playtesting rather than scattered as magic numbers across the engine.

```typescript
export const PROVISIONAL_REAL_TO_SIM_SECONDS = 60;       // 1 real sec = 60 sim sec
export const PROVISIONAL_SIMULATION_STEP_SECONDS = 60;   // 1 step = 1 in-game minute
export const PROVISIONAL_SPEED_PAUSED = 0;
export const PROVISIONAL_SPEED_1X = 1;
export const PROVISIONAL_SPEED_5X = 5;
export const PROVISIONAL_SPEED_15X = 15;
export const PROVISIONAL_SPEED_60X = 60;
export const PROVISIONAL_SPEED_MULTIPLIERS = [0, 1, 5, 15, 60] as const;
export const PROVISIONAL_STARTING_PERSONAL_CASH_MINOR: bigint = 50_000n; // $500.00
export const PROVISIONAL_DEFAULT_SPECIES_ID = 'species:proto-oak';
export const PROVISIONAL_DEFAULT_CURRENCY_ID = 'currency:leaf-dollar';
export const PROVISIONAL_DAYS_PER_SEASON = 30;
export const PROVISIONAL_DAYS_PER_YEAR = 120;
export const PROVISIONAL_DAY_START_FRACTION = 0.25;   // 06:00
export const PROVISIONAL_DAY_END_FRACTION = 0.75;    // 18:00
export const PROVISIONAL_INITIAL_INFLATION_RATE = 0;
export const PROVISIONAL_INITIAL_INTEREST_RATE = 0;
export const CURRENT_SCHEMA_VERSION = 1;
export const LEGACY_SCHEMA_VERSION_FOR_TESTS = 0;
```

### Convention for future agents

- When you need a provisional tuning value, declare it here with the `PROVISIONAL_` prefix and a `// PROVISIONAL (GDD §17: <item>)` comment.
- Do not introduce new magic numbers inside systems — import them from here.
- When a value is promoted from "provisional" to "decided" via playtesting, move it to a new `decided.ts` sibling and remove the `PROVISIONAL_` prefix. Leave a comment so the migration is traceable.

---

## 13. Import-boundary enforcement

Location: `packages/simulation/test/import-boundary.test.ts`.

Walks every `.ts` file under `packages/simulation/src/` and asserts none of them import:

- `next`, `react`, `react-dom`, `@reduxjs/*`, `idb`
- Any relative path that climbs out into `apps/` (e.g. `../../../apps/...`)
- The web app's `@/...` path alias

Comments and JSDoc that mention those names are allowed — the regex matches `import ... from '...'` statements only.

### To extend the boundary test (if you add a new forbidden dep)

Add a new RegExp to `FORBIDDEN_IMPORTS` in the test file. Keep the regex anchored on `^\s*import\s+[^;]*from\s+['"]...['"]` so it only matches real import statements.

---

## 14. The accumulator (consumer side)

Location: `apps/web/lib/use-engine-game.ts`.

```typescript
const loop = (now: number) => {
  const last = lastTimestampRef.current;
  lastTimestampRef.current = now;
  if (last != null) {
    const realDelta = (now - last) / 1000; // seconds
    const current = stateRef.current;
    if (!current.clock.paused && current.clock.speedMultiplier > 0) {
      const simDelta = realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS * current.clock.speedMultiplier;
      accumulatorRef.current += simDelta;
      if (accumulatorRef.current >= 1) {
        const result = engine.advance(stateRef.current, accumulatorRef.current);
        accumulatorRef.current -= result.consumedSeconds;
        stateRef.current = result.state;
        setState(result.state);
        appendEvents(result.events);
      }
    }
  }
  raf = requestAnimationFrame(loop);
};
```

The engine itself is pure and pause-agnostic; this hook is where the Pause contract is enforced (see §2).

### Offline catch-up (TDD §14.4 — future work)

On `load()`:

1. Validate the save (Storage.validate).
2. Read `metadata.lastSimulatedAt`.
3. Calculate elapsed real-world time.
4. Cap to a max allowed catch-up interval (safeguard).
5. Pass to `engine.advance(state, cappedElapsedSeconds)`.
6. Save the updated state.

P0 does NOT implement offline catch-up yet. P5 (Offline and Automation) will add it.

---

## 15. Test inventory

P0 ships 69 tests across 8 files. The full suite (`pnpm test`) runs in ~2 seconds.

| File                                          | Tests | Scope                                                       |
|-----------------------------------------------|-------|-------------------------------------------------------------|
| `packages/shared/test/schemas.test.ts`        | 12    | GameState superRefine, clock, season, constants              |
| `packages/shared/test/migrations.test.ts`     | 9     | MigrationRegistry + deserialize migration ordering regression|
| `packages/simulation/test/rng.test.ts`        | 8     | sfc32 determinism, save/load identity, fork independence    |
| `packages/simulation/test/time-system.test.ts`| 9     | seasonFromDay, timeOfDayFraction, tick/season-changed events|
| `packages/simulation/test/scheduler.test.ts`  | 5     | schedule / due / cancel + engine integration                |
| `packages/simulation/test/storage.test.ts`    | 9     | InMemoryStorage round-trip, Zod rejection, migration        |
| `packages/simulation/test/engine.test.ts`     | 16    | determinism, splittability, pause contract, speed, non-mutation |
| `packages/simulation/test/import-boundary.test.ts` | 1 | Import boundary enforcement (TDD §3)                       |

### Invariants continuously verified

- `originalTree.isOriginal === true` and `originalTree.id === 'original'` — schema superRefine.
- No silent save discard — `UnknownSchemaVersionError` raised for unknown versions.
- `engine.advance` does NOT mutate its input — deep-freeze + post-call deep-equal test.
- `engine.executeAction` does NOT mutate its input — same pattern.
- RNG position survives save/load — `getState()` + `fromState()` is identity-preserving.
- Splittability — `advance(N) + advance(M) == advance(N+M)` in both state and events.
- Unknown action types raise `UnknownActionError`.
- No forbidden imports in `packages/simulation/src/`.

---

## 16. TDD §21 acceptance criteria (P0-relevant)

| #  | Criterion                                                | P0 Status                                   |
|----|----------------------------------------------------------|---------------------------------------------|
| 11 | The game saves and restores correctly.                   | **PASS** — InMemoryStorage round-trip + IDB impl present |
| 12 | The original tree cannot be sold or transferred.         | **PARTIAL** — schema-layer invariant enforced; action-layer guard is P3's job |
| 14 | The simulation can be tested independently of Next.js.   | **PASS** — 69 tests run in pure Node, no Next.js in any test path |
| 15 | Simulation results are deterministic under identical inputs. | **PASS** — same seed → identical state + events; save/load preserves RNG position |

---

## 17. Working agreements for downstream agents

1. **Do not reorder the system registry** (§3, §4). The order is part of the determinism contract.
2. **Do not relax `tsconfig.base.json`** strictness flags.
3. **Do not add `Math.random()` / `Date.now()` inside `packages/simulation/src/`**. The import-boundary test does not yet grep for these — see NICE-TO-HAVE finding in the P0 review report. Until that test is extended, manual review is the safeguard.
4. **Do not mutate the input state in `advance` / `executeAction` / systems / action handlers**. Always `deepCopy` on entry. There are now regression tests for this.
5. **Register a migration whenever you change the GameState shape** (§10, §11).
6. **Add new provisional constants to `packages/shared/src/constants/provisional.ts`** with the `PROVISIONAL_` prefix and a GDD §17 pointer (§12).
7. **When extending SimulationEvent / GameAction, add a new variant — do NOT loosen the union** with a catch-all (§8, §9).
8. **The `originalTree` field is sacred.** Schema superRefine catches corruption; do not weaken it.
9. **The `Rng.fork(name)` produces an independent sub-stream.** Use it per-system so a system's draws don't shift other systems' sequences. If you need a fork's state to survive save/load, persist the child's state yourself.
10. **All monetary amounts are bigint minor units serialized as strings.** Never `number` for cash/transaction amounts. See `packages/shared/src/schemas/economy.ts` and `player.ts` for the pattern.

---

## 18. Quick links

- Engine entry point: `packages/simulation/src/simulation.ts`
- System interface: `packages/simulation/src/systems/system.ts`
- RNG: `packages/simulation/src/rng.ts`
- Scheduler: `packages/simulation/src/events/scheduler.ts`
- Action handlers: `packages/simulation/src/actions/handlers.ts`
- Storage interface + InMemoryStorage: `packages/simulation/src/persistence/storage.ts`
- IndexedDB storage: `apps/web/lib/persistence/indexed-db-storage.ts`
- Accumulator: `apps/web/lib/use-engine-game.ts`
- GameState schema: `packages/shared/src/schemas/game-state.ts`
- Provisional constants: `packages/shared/src/constants/provisional.ts`
- Migration registry: `packages/shared/src/migrations/registry.ts`
- Serialization (deserialize migrate-then-validate): `packages/shared/src/serialization/index.ts`
- Typed errors: `packages/shared/src/errors.ts`
- Import-boundary test: `packages/simulation/test/import-boundary.test.ts`
