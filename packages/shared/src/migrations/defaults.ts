/**
 * Default migrations for the current schema.
 *
 * v0 -> v1: a sample migration that the test suite exercises. v0 saves are
 * hypothetical (we never wrote one in production); the migration exists to
 * prove the framework works end-to-end.
 *
 * v1 -> v2 (P1): backfills `originalTree.pendingIssuances` with an empty
 * array if missing. P1 added this field to queue currency-issuance requests
 * produced by the `harvest-leaves` action handler. P3's EconomySystem
 * drains the queue each tick.
 *
 * v2 -> v3 (P1): backfills `originalTree.foliage.leafGrowthProgress` with
 * 0 if missing. P1 added this accumulator so per-step leaf-growth energy
 * isn't wasted when it's too small to grow a whole leaf.
 *
 * v3 -> v4 (P2): backfills four new GameState shapes for P2 (Resources +
 * Weather):
 *   - `world.weather: WeatherState` — current condition, temperature,
 *     intensity, prev condition, days-in-condition. Defaults to a sunny
 *     spring day at 18 °C.
 *   - `rngStreams.weather: RngState` — persisted RNG sub-stream for the
 *     WeatherSystem so the Markov sequence survives save/load. Defaults
 *     to a zero state (WeatherSystem initializes it on first tick if zero).
 *   - `world.environment.soil.soilWater: number` — soil water content (L).
 *     Defaults to PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER.
 *   - `world.environment.soil.{ph, compaction, microbialActivity}: number`
 *     — extension-point stubs for the soil health derivation. Defaults to
 *     6.5 / 0 / 1.0 respectively.
 *
 * v4 -> v5 (P3a): backfills four new EconomyState fields for the ledger +
 * transaction system (TDD §10.3, §10.4):
 *   - `economy.accounts: AccountState[]` — explicit account ledger. Seeded
 *     with two accounts: `player:personal` (carrying the existing
 *     `player.personalCash` balance) and `external:default` (balance 0).
 *   - `economy.processedRequestIds: string[]` — idempotency set. Defaults
 *     to an empty array.
 *   - `economy.totalIssued: string` — cumulative currency ever issued.
 *     Defaults to `'0'` (the player's starting cash is treated as
 *     pre-existing, not issued by P3a's authority).
 *   - `economy.totalSinks: string` — cumulative currency removed from
 *     circulation. Defaults to `'0'`.
 *
 * The migration is pure and does NOT touch `originalTree.id` or
 * `originalTree.isOriginal` (GDD §16.1/16.2).
 *
 * v8 -> v9 (P7a): backfills the EnvironmentState additions for the
 * EnvironmentSystem (TDD §13, §5.5, §9.2; GDD §10, §170; resolves R-P6-3 /
 * R-P6-4):
 *   - `world.environment.atmosphere.methaneConcentration` — 1.9 (CH4 ppm).
 *   - `world.environment.atmosphere.nitrousOxideConcentration` — 0.33 (N2O ppm).
 *   - `world.environment.atmosphere.aerosols` — 0 (no aerosol perturbation).
 *   - `world.environment.climateForcing` — 0 W/m^2.
 *   - `world.environment.seaLevelRise` — 0 mm.
 *   - `world.environment.energy` — { stored: 0, capacity:
 *     PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT, generationRate: 0,
 *     consumptionRate: 0 }.
 *   - `world.environment.landUse` — { developed: 0, degraded: 0, protected: 0 }.
 *
 * All fields have Zod `.default(...)` so v8 saves parse cleanly under v9, but
 * the migration backfills them explicitly so consumers can rely on their
 * presence without re-running the zod default pipeline. Each field is
 * backfilled only if missing — a v8 save hand-patched with any of these
 * values keeps them. The migration is idempotent under repeated application
 * (defensive — the framework doesn't re-run migrations, but tests do) and is
 * a no-op when `world.environment` is absent (defensive; strict validation
 * catches the malformation downstream).
 *
 * Future agents: when you change GameState's shape, bump CURRENT_SCHEMA_VERSION
 * in constants/provisional.ts and add a real migration here. Migrations MUST
 * be pure and MUST NOT touch `originalTree.id` or `originalTree.isOriginal`.
 */
import type { GameState } from '../schemas/game-state.js';
import { type Migration, migrations } from './registry.js';
import { PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER } from '../constants/resources.js';
import {
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_LABEL,
  PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_LABEL,
} from '../constants/economy.js';
import { PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT } from '../constants/environment.js';

// Sample v0 -> v1 migration. v0 saves had no `scheduler` field; v1 adds it.
// (In reality, no v0 saves exist — this is here to demonstrate the framework.)
const v0ToV1: Migration = (state: GameState): GameState => {
  // We can't actually reconstruct the missing field with full fidelity from
  // a v0 save in the general case. For the sample migration we add an empty
  // scheduler if it's missing, and otherwise return the state unchanged.
  // `state` is typed as GameState (the v1 type) here for simplicity — a real
  // migration would have a separate v0 input type.
  return {
    ...state,
    scheduler: state.scheduler ?? { events: [] },
  };
};

// P1: v1 -> v2 migration. Backfills `originalTree.pendingIssuances` if a
// v1 save lacks it. The field is always present on v2+ saves.
const v1ToV2: Migration = (state: GameState): GameState => {
  const originalTree = state.originalTree as typeof state.originalTree & {
    pendingIssuances?: unknown;
  };
  if (Array.isArray(originalTree.pendingIssuances)) {
    return state;
  }
  return {
    ...state,
    originalTree: {
      ...state.originalTree,
      pendingIssuances: [],
    },
  };
};

// P1: v2 -> v3 migration. Backfills `originalTree.foliage.leafGrowthProgress`
// with 0 if a v2 save lacks it. The field is always present on v3+ saves.
const v2ToV3: Migration = (state: GameState): GameState => {
  const foliage = state.originalTree.foliage as typeof state.originalTree.foliage & {
    leafGrowthProgress?: unknown;
  };
  if (typeof foliage.leafGrowthProgress === 'number') {
    return state;
  }
  return {
    ...state,
    originalTree: {
      ...state.originalTree,
      foliage: {
        ...state.originalTree.foliage,
        leafGrowthProgress: 0,
      },
    },
  };
};

// P2: v3 -> v4 migration. Backfills P2's new GameState shapes:
//   - world.weather
//   - rngStreams.weather
//   - world.environment.soil.soilWater
//   - world.environment.soil.{ph, compaction, microbialActivity}
//
// Each field is backfilled only if missing — fields added by other migrations
// (or by a v3+ save that already includes them) are left untouched. This
// makes the migration idempotent under repeated application (defensive — the
// migration framework doesn't re-run migrations, but tests do).
const v3ToV4: Migration = (state: GameState): GameState => {
  const out: GameState = { ...state };

  // 1. rngStreams.weather (top-level addition).
  const rngStreams = out.rngStreams as { weather?: unknown } | undefined;
  const isRngState =
    Array.isArray(rngStreams?.weather) && (rngStreams!.weather as unknown[]).length === 4;
  if (!isRngState) {
    out.rngStreams = { weather: [0, 0, 0, 0] };
  }

  // 2. world.weather — backfill the entire WeatherState if missing.
  const world = out.world as typeof out.world & {
    weather?: unknown;
  };
  if (
    typeof world.weather !== 'object' ||
    world.weather === null ||
    Array.isArray(world.weather)
  ) {
    out.world = {
      ...out.world,
      weather: {
        condition: 'sunny',
        temperature: 18,
        intensity: 0.5,
        prevCondition: null,
        daysInCondition: 0,
      },
    };
  }

  // 3. world.environment.soil.{soilWater, ph, compaction, microbialActivity}.
  const soil = out.world.environment.soil as typeof out.world.environment.soil & {
    soilWater?: unknown;
    ph?: unknown;
    compaction?: unknown;
    microbialActivity?: unknown;
  };
  const soilPatch: Record<string, unknown> = {};
  if (typeof soil.soilWater !== 'number') {
    soilPatch.soilWater = PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER;
  }
  if (typeof soil.ph !== 'number') {
    soilPatch.ph = 6.5;
  }
  if (typeof soil.compaction !== 'number') {
    soilPatch.compaction = 0;
  }
  if (typeof soil.microbialActivity !== 'number') {
    soilPatch.microbialActivity = 1.0;
  }
  if (Object.keys(soilPatch).length > 0) {
    out.world = {
      ...out.world,
      environment: {
        ...out.world.environment,
        soil: {
          ...out.world.environment.soil,
          ...soilPatch,
        },
      },
    };
  }

  return out;
};

migrations.register(0, v0ToV1);
migrations.register(1, v1ToV2);
migrations.register(2, v2ToV3);
migrations.register(3, v3ToV4);

// P3a: v4 -> v5 migration. Backfills four new EconomyState fields for the
// ledger + transaction system:
//   - economy.accounts
//   - economy.processedRequestIds
//   - economy.totalIssued
//   - economy.totalSinks
//
// `accounts` is seeded with two entries:
//   1. `player:personal` carrying the existing `player.personalCash` balance
//      (so the conservation invariant holds: `sum(balances) + totalSinks
//      === initialSupply + totalIssued` where `initialSupply = personalCash`
//      and `totalIssued = totalSinks = 0`).
//   2. `external:default` with balance `'0'` (placeholder for P3b markets).
//
// Each field is backfilled only if missing — fields already present on a
// v5 save (or a v4 save that someone hand-patched) are left untouched. This
// makes the migration idempotent under repeated application (defensive — the
// migration framework doesn't re-run migrations, but tests do).
//
// The migration is pure and does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
const v4ToV5: Migration = (state: GameState): GameState => {
  const out: GameState = { ...state };
  const economy = out.economy as typeof out.economy & {
    accounts?: unknown;
    processedRequestIds?: unknown;
    totalIssued?: unknown;
    totalSinks?: unknown;
  };

  const patch: Record<string, unknown> = {};

  // 1. accounts — backfill only if missing or empty.
  if (!Array.isArray(economy.accounts) || economy.accounts.length === 0) {
    patch.accounts = [
      {
        id: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        type: 'player',
        label: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_LABEL,
        balance: out.player.personalCash,
      },
      {
        id: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        type: 'external',
        label: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_LABEL,
        balance: '0',
      },
    ];
  }

  // 2. processedRequestIds — backfill with empty array if missing.
  if (!Array.isArray(economy.processedRequestIds)) {
    patch.processedRequestIds = [];
  }

  // 3. totalIssued — backfill with '0' if missing. (The player's starting
  //    cash is treated as pre-existing — P3a's authority has issued nothing
  //    yet. The conservation invariant treats the starting `personalCash`
  //    as `initialSupply`, not `totalIssued`.)
  if (typeof economy.totalIssued !== 'string') {
    patch.totalIssued = '0';
  }

  // 4. totalSinks — backfill with '0' if missing.
  if (typeof economy.totalSinks !== 'string') {
    patch.totalSinks = '0';
  }

  if (Object.keys(patch).length > 0) {
    out.economy = { ...out.economy, ...patch } as typeof out.economy;
  }

  return out;
};

migrations.register(4, v4ToV5);

// P3b: v5 -> v6 migration. Backfills two new EconomyState shapes for the
// market pricing + inflation index (TDD §10.6, GDD §8.5, §6.3):
//   - `economy.inflationIndex: number` — Laspeyres-style basket index of
//     current market prices vs their base prices. `1.0` at game start.
//     Defaults to `1.0` (no inflation observed yet on a fresh migration).
//   - `economy.markets[*].lastPriceUpdate: number` — simulation second at
//     which a market's `price` was last recomputed by the EconomySystem.
//     Defaults to `0` for each existing market entry.
//
// Both fields have Zod `.default(...)` so v5 saves already parse cleanly
// under v6, but the migration backfills them explicitly so consumers can
// rely on the fields being present without re-running through zod's default
// pipeline. The migration is idempotent under repeated application
// (defensive — the framework doesn't re-run migrations, but tests do).
//
// The migration does NOT add the 5 P3b commodity markets (water, fertilizer,
// seeds, food, energy) to legacy saves — only the new initial-state does.
// Old saves keep their existing markets (usually the single placeholder
// `market:default` currency market) and continue playing. New games started
// under v6 get the 5 commodity markets via `initializeState()`.
//
// The migration is pure and does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
const v5ToV6: Migration = (state: GameState): GameState => {
  const out: GameState = { ...state };
  const economy = out.economy as typeof out.economy & {
    inflationIndex?: unknown;
  };

  const patch: Record<string, unknown> = {};

  // 1. inflationIndex — backfill with 1.0 if missing.
  if (typeof economy.inflationIndex !== 'number' || !isFinite(economy.inflationIndex)) {
    patch.inflationIndex = 1.0;
  }

  // 2. markets[*].lastPriceUpdate — backfill with 0 if any market is missing it.
  if (Array.isArray(out.economy.markets)) {
    let mutated = false;
    const patchedMarkets = out.economy.markets.map((m) => {
      const withMaybe = m as typeof m & { lastPriceUpdate?: unknown };
      if (typeof withMaybe.lastPriceUpdate !== 'number') {
        mutated = true;
        return { ...m, lastPriceUpdate: 0 };
      }
      return m;
    });
    if (mutated) {
      patch.markets = patchedMarkets;
    }
  }

  if (Object.keys(patch).length > 0) {
    out.economy = { ...out.economy, ...patch } as typeof out.economy;
  }

  return out;
};

migrations.register(5, v5ToV6);

// P3c: v6 -> v7 migration. Backfills one new PlayerState field for the
// PersonalSystem (TDD §11, GDD §7):
//   - `player.unpaidDays: number` — cumulative counter of unpaid
//     living-expense days. Defaults to 0 (no unpaid days at migration
//     time — the PersonalSystem starts tracking unpaid bills from the
//     next due bill forward).
//
// The field has a Zod `.default(0)`, so v6 saves parse cleanly under v7, but
// the migration backfills it explicitly so consumers can rely on the field
// being present without re-running through zod's default pipeline. The
// migration is idempotent under repeated application (defensive — the
// framework doesn't re-run migrations, but tests do).
//
// The migration is pure and does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
const v6ToV7: Migration = (state: GameState): GameState => {
  const out: GameState = { ...state };
  const player = out.player as typeof out.player & { unpaidDays?: unknown };

  if (typeof player.unpaidDays !== 'number' || !Number.isFinite(player.unpaidDays)) {
    out.player = {
      ...out.player,
      unpaidDays: 0,
    };
  }

  return out;
};

migrations.register(6, v6ToV7);

// P6b1: v7 -> v8 migration. Extends each `AutomationState` entry with three
// new optional fields for the condition-based automation engine (TDD §12,
// GDD §9):
//   - `automation[*].policy: AutomationPolicy` — optional discriminated-union
//     trigger (threshold | event | schedule). Absent on P0–P6a interval-only
//     automations.
//   - `automation[*].lastRunAt: number` — sim seconds of last execution.
//   - `automation[*].cooldownSeconds: number` — min gap between runs.
//
// All three fields are optional (no Zod default), so v7 saves parse cleanly
// under v8. The migration backfills `lastRunAt: 0` and `cooldownSeconds: 0`
// on each existing automation entry explicitly (so consumers can rely on the
// fields being present without re-running the zod default pipeline) and
// leaves `policy` absent when missing — a discriminated union has no natural
// default, and `policy: undefined` serializes to absent in JSON anyway. This
// matches the convention of v6 -> v7 (explicit backfill of optional fields so
// consumers don't depend on zod's default fallback).
//
// Each field is backfilled only if missing — fields already present on a v8
// save (or a v7 save hand-patched with a policy) are left untouched. This
// makes the migration idempotent under repeated application (defensive — the
// framework doesn't re-run migrations, but tests do).
//
// The migration is pure and does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
const v7ToV8: Migration = (state: GameState): GameState => {
  const out: GameState = { ...state };
  if (!Array.isArray(out.automation) || out.automation.length === 0) {
    return out;
  }

  let mutated = false;
  const patchedAutomation = out.automation.map((entry) => {
    const withMaybe = entry as typeof entry & {
      lastRunAt?: unknown;
      cooldownSeconds?: unknown;
    };
    const patch: Record<string, unknown> = {};
    if (typeof withMaybe.lastRunAt !== 'number' || !Number.isFinite(withMaybe.lastRunAt)) {
      patch.lastRunAt = 0;
    }
    if (
      typeof withMaybe.cooldownSeconds !== 'number' ||
      !Number.isFinite(withMaybe.cooldownSeconds)
    ) {
      patch.cooldownSeconds = 0;
    }
    // `policy` is left absent when missing — no natural default for a
    // discriminated union, and absent == `undefined` after JSON round-trip.
    if (Object.keys(patch).length === 0) {
      return entry;
    }
    mutated = true;
    return { ...entry, ...patch };
  });

  if (mutated) {
    out.automation = patchedAutomation;
  }

  return out;
};

migrations.register(7, v7ToV8);

// P7a: v8 -> v9 migration. Backfills the EnvironmentState additions for the
// EnvironmentSystem (TDD §13, §5.5, §9.2; GDD §10, §170; resolves R-P6-3 /
// R-P6-4 from docs/offline-automation.md §6.3 / §6.4):
//   - atmosphere.methaneConcentration / nitrousOxideConcentration / aerosols
//   - climateForcing
//   - seaLevelRise
//   - energy { stored, capacity, generationRate, consumptionRate }
//   - landUse { developed, degraded, protected }
//
// All fields have Zod `.default(...)` so v8 saves already parse cleanly under
// v9, but the migration backfills them explicitly so consumers can rely on
// the fields being present without re-running through zod's default pipeline
// (matching the v3 -> v4 / v5 -> v6 / v6 -> v7 convention).
//
// Each field is backfilled only if missing — a v8 save hand-patched with any
// of these values keeps them. This makes the migration idempotent under
// repeated application (defensive — the framework doesn't re-run migrations,
// but tests do). If `world.environment` is absent the migration returns the
// state unchanged (defensive; strict post-migration validation catches the
// malformation — the schema requires `world.environment`).
//
// `energy.stored` is backfilled to 0 (no legacy save starts with free
// energy); `energy.capacity` to PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT
// so a freshly-migrated save can bank surplus once a solar panel is
// installed. The EnvironmentSystem (P7b) raises `capacity` when a battery is
// actually purchased.
//
// The migration is pure and does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
const v8ToV9: Migration = (state: GameState): GameState => {
  const out: GameState = { ...state };

  // Defensive: `world.environment` is required by the schema, but a malformed
  // save might lack it. Bail out unchanged and let strict validation report
  // the error downstream rather than crashing the migration.
  const env = out.world?.environment as
    | (typeof out.world.environment & {
        climateForcing?: unknown;
        seaLevelRise?: unknown;
        energy?: unknown;
        landUse?: unknown;
      })
    | undefined;
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return out;
  }

  const envPatch: Record<string, unknown> = {};

  // 1. atmosphere.methaneConcentration — 1.9 ppm (real-world-ish baseline).
  const atmosphere = env.atmosphere as typeof env.atmosphere & {
    methaneConcentration?: unknown;
    nitrousOxideConcentration?: unknown;
    aerosols?: unknown;
  };
  const atmospherePatch: Record<string, unknown> = {};
  if (
    typeof atmosphere.methaneConcentration !== 'number' ||
    !Number.isFinite(atmosphere.methaneConcentration)
  ) {
    atmospherePatch.methaneConcentration = 1.9;
  }
  if (
    typeof atmosphere.nitrousOxideConcentration !== 'number' ||
    !Number.isFinite(atmosphere.nitrousOxideConcentration)
  ) {
    atmospherePatch.nitrousOxideConcentration = 0.33;
  }
  if (typeof atmosphere.aerosols !== 'number' || !Number.isFinite(atmosphere.aerosols)) {
    atmospherePatch.aerosols = 0;
  }
  if (Object.keys(atmospherePatch).length > 0) {
    envPatch.atmosphere = { ...env.atmosphere, ...atmospherePatch };
  }

  // 2. climateForcing — 0 W/m^2 (no perturbation at baseline).
  if (typeof env.climateForcing !== 'number' || !Number.isFinite(env.climateForcing)) {
    envPatch.climateForcing = 0;
  }

  // 3. seaLevelRise — 0 mm above baseline.
  if (typeof env.seaLevelRise !== 'number' || !Number.isFinite(env.seaLevelRise)) {
    envPatch.seaLevelRise = 0;
  }

  // 4. energy pool — { stored: 0, capacity: default, rates: 0 }.
  if (
    typeof env.energy !== 'object' ||
    env.energy === null ||
    Array.isArray(env.energy)
  ) {
    envPatch.energy = {
      stored: 0,
      capacity: PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
      generationRate: 0,
      consumptionRate: 0,
    };
  }

  // 5. landUse — { developed: 0, degraded: 0, protected: 0 }.
  if (
    typeof env.landUse !== 'object' ||
    env.landUse === null ||
    Array.isArray(env.landUse)
  ) {
    envPatch.landUse = { developed: 0, degraded: 0, protected: 0 };
  }

  if (Object.keys(envPatch).length > 0) {
    out.world = {
      ...out.world,
      environment: { ...env, ...envPatch } as typeof out.world.environment,
    };
  }

  return out;
};

migrations.register(8, v8ToV9);
