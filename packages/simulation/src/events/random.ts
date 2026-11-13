/**
 * Stochastic event rolling (P10c — resolves P10b R-P10-N; TDD §6.4 Event
 * Scheduling; GDD §10.3 environmental feedback → event probability).
 *
 * Pure helpers used by the EventSystem (slot #12). This module adds the
 * stochastic event rolling P10b deferred: each scheduler check (throttled by
 * `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS`) rolls a base probability
 * (`PROVISIONAL_EVENT_BASE_PROBABILITY`) scaled by global degradation (worse
 * environment → more events) and, if triggered, picks an eligible event type
 * weighted by `probabilityWeight × triggerConditions`, rolls a random severity
 * within the definition's `severityRange`, rolls a random duration within the
 * `durationRange`, and schedules it to fire next tick.
 *
 * RNG — R-P10-N RESOLVED (seeded sub-RNG, ZERO root draws):
 *   P10b deferred random rolling because `Rng.fork()` advances the shared root
 *   RNG by exactly one draw by design (rng.ts:136 — `fork()` calls `this.next()`
 *   to seed the child). The persisted `GameState.rngState` is the root state
 *   AFTER all per-step forks, so adding a per-step EventSystem fork at slot #12
 *   would shift the BiologySystem (#3) + AutomationSystem (#9) child seeds at
 *   every subsequent tick — breaking the calibrated mortality / catch-up death
 *   sequences pinned by the P7d / P8b determinism tests.
 *
 *   P10c resolves this with a SEEDED sub-RNG that does NOT touch the root RNG.
 *   `createEventSubRng(state, currentTick)` derives a 32-bit seed via an
 *   FNV-1a-style hash of (`state.rngState` + `currentTick` + 'events'), then
 *   constructs a fresh `Rng.fromSeed(seed)`. The root `Rng` is NEVER advanced
 *   — the sub-RNG draws come from a hash-derived seed, not from `rng.next()`.
 *   This matches the R-P9-1 precedent (the ProgressionSystem at slot #11 also
 *   avoids a root fork) and the P9c `mutateTraitMagnitude` sub-RNG approach.
 *
 *   Determinism preserved: same `rngState` + same `currentTick` → same hash →
 *   same sub-seed → same event sequence (verified by `events-random.test.ts`'s
 *   same-seed-same-sequence test). Root RNG unchanged across an
 *   EventSystem.execute (verified by the existing `events.test.ts` zero-root-
 *   draw test — it still passes because `rollRandomEvents` never calls
 *   `ctx.rng.next()` / `ctx.rng.fork()`).
 *
 * All helpers are pure: they return a new state (and events) without mutating
 * the input (TDD §4.1, §18.4). Deterministic given (state, currentTick) — the
 * sub-RNG is a pure function of (rngState, currentTick).
 */
import type {
  GameState,
  SimulationEvent,
  RegionState,
  EventDefinition,
  EventSeverity,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_EVENT_BASE_PROBABILITY,
  PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS,
  PROVISIONAL_EVENT_SEVERITY_SCALING,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';
import { EVENT_DEFINITIONS, getEventDefinitionById } from '@capitalist-tree/content';
import { Rng } from '../rng.js';
import { scheduleEvent } from './scheduler.js';

// ---------------------------------------------------------------------------
// Local @provisional rolling tuning constants (GDD §17 — event balance)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: event balance)
// Max number of random events rolled per scheduler check (caps the per-check
// event storm so a fully-degraded world does not fire all 15 events at once).
// PROVISIONAL.
const PROVISIONAL_MAX_RANDOM_EVENTS_PER_CHECK = 2;

// The scheduler fires scheduled events at `scheduledAt <= currentTick`. Rolling
// schedules the event one tick ahead so it fires on the NEXT check (avoids
// re-entrancy with this check's firing phase).
const FIRE_NEXT_TICK_OFFSET = 1;

const SEVERITIES: readonly EventSeverity[] = ['minor', 'moderate', 'severe', 'catastrophic'];

/**
 * FNV-1a-style 32-bit hash of a string + a numeric salt. Deterministic,
 * non-cryptographic — used to derive a sub-seed from (`rngState`, `currentTick`,
 * salt) without touching the root RNG. Returns a nonzero 32-bit unsigned int.
 */
function hashStringAndNumbers(
  rngState: readonly [number, number, number, number],
  currentTick: number,
  salt: string,
): number {
  // FNV-1a offsets / primes (32-bit).
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h = Math.imul(h ^ (n >>> 0), 0x01000193) >>> 0;
  };
  for (let i = 0; i < salt.length; i++) mix(salt.charCodeAt(i));
  mix(rngState[0]);
  mix(rngState[1]);
  mix(rngState[2]);
  mix(rngState[3]);
  mix(currentTick);
  return h || 1; // never 0 (Rng.fromSeed(0) is fine but keep the convention)
}

/**
 * `createEventSubRng` — derive a SEEDED sub-RNG for stochastic event rolling
 * from (`state.rngState`, `currentTick`, 'events') WITHOUT advancing the root
 * RNG (R-P10-N resolved). The root `Rng` is never constructed or drawn from
 * here; the sub-RNG is built directly from the hash-derived seed. Pure +
 * deterministic given (rngState, currentTick).
 *
 * The EventSystem passes `ctx.rng` through for API symmetry but
 * `rollRandomEvents` does NOT call `ctx.rng.next()` / `ctx.rng.fork()` — it
 * builds the sub-RNG from the persisted `state.rngState` so a save/load
 * reproduces the same roll sequence (the sub-seed is a pure function of the
 * persisted state, not of the transient `ctx.rng` position).
 */
export function createEventSubRng(state: GameState, currentTick: number): Rng {
  const seed = hashStringAndNumbers(state.rngState, currentTick, 'events');
  return Rng.fromSeed(seed);
}

// ---------------------------------------------------------------------------
// Trigger-condition evaluation (content `triggerConditions` — descriptive
// strings; GDD §10.3 / §8.5)
// ---------------------------------------------------------------------------

/**
 * Derive the current season from the clock day-of-year (matches the
 * TimeSystem's season derivation convention in clock.ts: spring first).
 */
function seasonFromDay(day: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  const doy = day % 365;
  if (doy >= 60 && doy < 152) return 'spring';
  if (doy >= 152 && doy < 244) return 'summer';
  if (doy >= 244 && doy < 335) return 'autumn';
  return 'winter';
}

/**
 * Evaluate a single content `triggerCondition` string against a region + the
 * global state. Supports the descriptive patterns used in
 * `packages/content/src/events/event-types.ts`:
 *   - `field < value` / `field > value` / `field == value` (numeric compare)
 *     where `field` is a regional indicator (`waterAvailability`, `soilHealth`,
 *     `biodiversity`, `forestCoverage`, `industrialActivity`) or a nested
 *     climate field (`temperatureBaseline`, `precipitationBaseline`,
 *     `humidityBaseline`) or a pollution field (`pollution.air`, …).
 *   - `field above/below regional average` — compares the region's field to the
 *     cross-regional mean.
 *   - `field above/below threshold` — compares to a @provisional fixed
 *     threshold (air-pollution threshold 30, etc.).
 *   - `field above/below trend` — compares a global market index to its 100
 *     baseline.
 *   - `season in (a, b)` / `season == x` — clock season membership.
 *   - `globalTemperature > baseline + N` — P7 warming anomaly.
 *   - `atmosphericCarbon > N` — P7 CO2 concentration.
 *   - `environmentalRegulations < N` / `interestRate > N` / `moneySupplyGrowth
 *     > N` — policy fields.
 *   - `globalMarketIndices["id"] above/below N` — market index compare.
 *   - `vulnerabilities contains "tag"` — regional vulnerability membership.
 *   - `recession active` — an `event:recession` is in the active list.
 *
 * Conditions that reference no region (purely global — season, globalTemperature,
 * atmosphericCarbon, policy, market indices, recession active) are evaluated
 * against the global state and are region-independent. Unknown condition
 * patterns default to `true` (a condition the roller cannot parse is treated
 * as not-gating — defensive, documented @provisional).
 */
function evaluateCondition(
  condition: string,
  region: RegionState,
  state: GameState,
): boolean {
  const trimmed = condition.trim();

  // --- season membership / equality ---
  const seasonMatch = trimmed.match(/^season\s*(==|in)\s*\(?\s*([a-z,\s]+)\)?$/);
  if (seasonMatch) {
    const current = seasonFromDay(state.clock.day);
    const list = seasonMatch[2].split(/[,\s]+/).filter(Boolean);
    return list.includes(current);
  }

  // --- recession active ---
  if (trimmed === 'recession active') {
    return state.eventState.scheduler.active.some((a) => a.type === 'event:recession');
  }

  // --- vulnerabilities contains "tag" ---
  const vulnMatch = trimmed.match(/^vulnerabilities\s+contains\s+"([^"]+)"$/);
  if (vulnMatch) {
    return region.vulnerabilities.includes(vulnMatch[1]);
  }

  // --- globalTemperature > baseline + N ---
  const tempMatch = trimmed.match(/^globalTemperature\s*>\s*baseline\s*\+\s*(\d+(?:\.\d+)?)$/);
  if (tempMatch) {
    return state.world.environment.globalTemperature > 14 + Number(tempMatch[1]);
  }

  // --- atmosphericCarbon > N ---
  const carbonMatch = trimmed.match(/^atmosphericCarbon\s*([<>]=?)\s*(\d+(?:\.\d+)?)$/);
  if (carbonMatch) {
    const co2 = state.world.environment.atmosphere.co2Concentration;
    return compare(co2, carbonMatch[1], Number(carbonMatch[2]));
  }

  // --- environmentalRegulations / interestRate / moneySupplyGrowth < N ---
  const policyMatch = trimmed.match(
    /^(environmentalRegulations|interestRate|moneySupplyGrowth)\s*([<>]=?)\s*(\d+(?:\.\d+)?)$/,
  );
  if (policyMatch) {
    const field = policyMatch[1];
    const op = policyMatch[2];
    const value = Number(policyMatch[3]);
    if (field === 'environmentalRegulations') {
      return compare(state.eventState.global.governmentPolicy.environmentalRegulations, op, value);
    }
    return compare(state.eventState.global.monetaryPolicy[field as 'interestRate' | 'moneySupplyGrowth'], op, value);
  }

  // --- globalMarketIndices["id"] above/below N ---
  const idxMatch = trimmed.match(/^globalMarketIndices\["([^"]+)"\]\s+(above|below)\s+(\d+(?:\.\d+)?)$/);
  if (idxMatch) {
    const level = state.eventState.global.globalMarketIndices[idxMatch[1]] ?? 100;
    const value = Number(idxMatch[3]);
    return idxMatch[2] === 'above' ? level > value : level < value;
  }
  const trendMatch = trimmed.match(/^globalMarketIndices\["([^"]+)"\]\s+(above|below)\s+trend$/);
  if (trendMatch) {
    const level = state.eventState.global.globalMarketIndices[trendMatch[1]] ?? 100;
    return trendMatch[2] === 'above' ? level > 100 : level < 100;
  }

  // --- field above/below regional average ---
  const avgMatch = trimmed.match(/^([a-zA-Z.]+)\s+(above|below)\s+regional\s+average$/);
  if (avgMatch) {
    const field = avgMatch[1];
    const regions = state.eventState.global.regions;
    const mean = regions.length > 0 ? regions.reduce((a, r) => a + readRegionField(r, field), 0) / regions.length : 0;
    const val = readRegionField(region, field);
    return avgMatch[2] === 'above' ? val > mean : val < mean;
  }

  // --- field above/below threshold (air-pollution threshold 30) ---
  const threshMatch = trimmed.match(/^([a-zA-Z.]+)\s+(above|below)\s+threshold$/);
  if (threshMatch) {
    const field = threshMatch[1];
    const val = readRegionField(region, field);
    // @provisional fixed thresholds.
    const threshold = field === 'pollution.air' ? 30 : field === 'pollution.water' ? 20 : 0.5;
    return threshMatch[2] === 'above' ? val > threshold : val < threshold;
  }

  // --- numeric compare: field < value / > value / == value ---
  const cmpMatch = trimmed.match(/^([a-zA-Z.]+)\s*([<>]=?|==)\s*(\d+(?:\.\d+)?)$/);
  if (cmpMatch) {
    const field = cmpMatch[1];
    const op = cmpMatch[2];
    const value = Number(cmpMatch[3]);
    return compare(readRegionField(region, field), op, value);
  }

  // Unknown condition pattern — do not gate (defensive, @provisional).
  return true;
}

/** Compare two numbers with a textual operator. */
function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return a === b;
    default:
      return false;
  }
}

/** Read a regional field by name (top-level + nested climate / pollution). */
function readRegionField(region: RegionState, field: string): number {
  if (field.startsWith('climate.')) {
    const key = field.slice('climate.'.length) as keyof RegionState['climate'];
    return region.climate[key] as number;
  }
  if (field.startsWith('pollution.')) {
    const key = field.slice('pollution.'.length) as keyof RegionState['pollution'];
    return region.pollution[key] as number;
  }
  switch (field) {
    case 'soilHealth':
      return region.soilHealth;
    case 'waterAvailability':
      return region.waterAvailability;
    case 'biodiversity':
      return region.biodiversity;
    case 'forestCoverage':
      return region.forestCoverage;
    case 'industrialActivity':
      return region.industrialActivity;
    case 'humidityBaseline':
      return region.climate.humidityBaseline;
    case 'temperatureBaseline':
      return region.climate.temperatureBaseline;
    case 'precipitationBaseline':
      return region.climate.precipitationBaseline;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Eligibility + weighted pick
// ---------------------------------------------------------------------------

/**
 * An eligible (definition, region) pair for random rolling — a definition
 * whose `triggerConditions` all pass for the region.
 */
interface EligibleCandidate {
  readonly definition: EventDefinition;
  readonly region: RegionState;
}

/**
 * Collect every (definition, region) pair whose `triggerConditions` all pass.
 * Definitions with NO region-specific conditions are eligible for every region
 * (a region-less global event). Returns the full eligible list. Pure +
 * read-only.
 */
export function collectEligibleEvents(state: GameState): EligibleCandidate[] {
  const regions = state.eventState.global.regions;
  if (regions.length === 0) return [];
  const candidates: EligibleCandidate[] = [];
  for (const def of EVENT_DEFINITIONS) {
    for (const region of regions) {
      const allPass = def.triggerConditions.every((c) => evaluateCondition(c, region, state));
      if (allPass) {
        candidates.push({ definition: def, region });
      }
    }
  }
  return candidates;
}

/**
 * Global degradation scalar in [0, 1] — drives the probability multiplier
 * (worse environment → more events). Composite of inverted ecosystem
 * resilience + species-extinction penalty + warming anomaly. Pure + read-only.
 */
export function globalDegradation(state: GameState): number {
  const indicators = state.eventState.global.aggregatedIndicators;
  let degradation = 1 - indicators.ecosystemResilience;
  degradation += Math.min(0.3, indicators.speciesExtinctionRate * 0.1);
  // Warming anomaly contributes (a +4 °C world is fully degraded for this
  // purpose). @provisional.
  const warming = Math.max(0, state.world.environment.globalTemperature - 14);
  degradation += Math.min(0.3, warming / 4 * 0.3);
  return Math.max(0, Math.min(1, degradation));
}

/**
 * Roll a random severity within the definition's `severityRange` (inclusive),
 * biased toward the lower end by the @provisional base weights. Uses the
 * sub-RNG. Pure given the sub-RNG state.
 */
function rollSeverity(rng: Rng, def: EventDefinition): EventSeverity {
  const [min, max] = def.severityRange;
  const minIdx = SEVERITIES.indexOf(min);
  const maxIdx = SEVERITIES.indexOf(max);
  // Weighted toward the lower severity (minor/moderate more common than
  // severe/catastrophic). @provisional weights.
  const weights = [4, 3, 2, 1]; // minor, moderate, severe, catastrophic
  const eligibleIdx: number[] = [];
  const eligibleWeights: number[] = [];
  for (let i = minIdx; i <= maxIdx; i++) {
    eligibleIdx.push(i);
    eligibleWeights.push(weights[i]!);
  }
  const total = eligibleWeights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < eligibleIdx.length; i++) {
    r -= eligibleWeights[i]!;
    if (r <= 0) return SEVERITIES[eligibleIdx[i]!]!;
  }
  return SEVERITIES[eligibleIdx[eligibleIdx.length - 1]!]!;
}

/**
 * Roll a random duration (ticks) within the definition's `durationRange`
 * (inclusive). Uses the sub-RNG. Pure given the sub-RNG state.
 */
function rollDuration(rng: Rng, def: EventDefinition): number {
  const [min, max] = def.durationRange;
  return rng.nextInt(min, max);
}

// ---------------------------------------------------------------------------
// rollRandomEvents — the per-check stochastic roll (R-P10-N resolved)
// ---------------------------------------------------------------------------

/**
 * `rollRandomEvents` — the per-check stochastic event roll (TDD §6.4; GDD §10.3
 * feedback → event probability). Pure: returns a new state + `event-scheduled`
 * events for the rolled events.
 *
 * Self-throttles: a no-op when the current tick index is NOT a multiple of
 * `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS` (the same cadence as
 * `processScheduledEvents`). When it runs:
 *
 *   1. Build the SEEDED sub-RNG via `createEventSubRng(state, currentTick)` —
 *      a hash of (`rngState`, `currentTick`, 'events'). ZERO root draws
 *      (R-P10-N resolved — see the file-level doc).
 *   2. Compute the degradation scalar (`globalDegradation`) + the probability
 *      multiplier `1 + degradation * PROVISIONAL_EVENT_SEVERITY_SCALING`.
 *   3. Collect eligible (definition, region) candidates whose
 *      `triggerConditions` all pass.
 *   4. For up to `PROVISIONAL_MAX_RANDOM_EVENTS_PER_CHECK` attempts: roll
 *      `PROVISIONAL_EVENT_BASE_PROBABILITY × multiplier`; if triggered, pick a
 *      weighted-random eligible candidate (`probabilityWeight`), roll severity
 *      + duration, schedule it to fire next tick via `scheduleEvent`
 *      (`scheduledAt = currentTick + FIRE_NEXT_TICK_OFFSET`, payload carries
 *      `regionId` + `severity` + `duration`).
 *
 * The rolled events fire on the NEXT check via `processScheduledEvents` — they
 * do NOT fire this check (avoids re-entrancy). Deterministic given (state,
 * currentTick) — the sub-RNG is a pure function of the persisted `rngState` +
 * `currentTick`.
 */
export function rollRandomEvents(
  state: GameState,
  currentTick: number,
): { state: GameState; events: SimulationEvent[] } {
  // Throttle gate — only roll on the check cadence.
  if (currentTick % PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS !== 0) {
    return { state, events: [] };
  }

  const candidates = collectEligibleEvents(state);
  if (candidates.length === 0) {
    return { state, events: [] };
  }

  const subRng = createEventSubRng(state, currentTick);
  const degradation = globalDegradation(state);
  const multiplier = 1 + degradation * PROVISIONAL_EVENT_SEVERITY_SCALING;
  const baseProb = PROVISIONAL_EVENT_BASE_PROBABILITY * multiplier;

  const now = currentTick * PROVISIONAL_SIMULATION_STEP_SECONDS;
  let next: GameState = state;
  const events: SimulationEvent[] = [];

  for (let attempt = 0; attempt < PROVISIONAL_MAX_RANDOM_EVENTS_PER_CHECK; attempt++) {
    const roll = subRng.next();
    if (roll >= baseProb) {
      // No event this attempt — continue to the next attempt (a later attempt
      // can still fire independently).
      continue;
    }
    // Weighted pick among eligible candidates.
    const totalWeight = candidates.reduce((a, c) => a + c.definition.probabilityWeight, 0);
    let r = subRng.next() * totalWeight;
    let picked = candidates[candidates.length - 1]!;
    for (const c of candidates) {
      r -= c.definition.probabilityWeight;
      if (r <= 0) {
        picked = c;
        break;
      }
    }
    const severity = rollSeverity(subRng, picked.definition);
    const duration = rollDuration(subRng, picked.definition);
    const payload: Record<string, unknown> = {
      regionId: picked.region.id,
      severity,
      duration,
    };
    const result = scheduleEvent(
      next,
      picked.definition.id,
      currentTick + FIRE_NEXT_TICK_OFFSET,
      payload,
      'normal',
      now,
    );
    next = result.state;
    events.push(...result.events);
  }

  return { state: next, events };
}

/**
 * Read-only access to the @provisional rolling tuning constants for tests +
 * future tuning promotion (rule 10).
 */
export const RANDOM_CONSTANTS = {
  PROVISIONAL_MAX_RANDOM_EVENTS_PER_CHECK,
  FIRE_NEXT_TICK_OFFSET,
} as const;

// Re-export the eligibility + degradation helpers for tests.
export { collectEligibleEvents, globalDegradation, createEventSubRng };
