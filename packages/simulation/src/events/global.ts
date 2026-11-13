/**
 * Global state application + government / monetary policy (P10b — TDD §6.4
 * Event Scheduling, TDD line 200 EventSystem; GDD §10 Environment and
 * Climate, §148-152 influence over regional/global markets/governments/
 * regulations, §404-408 monetary authority + monetary policy tools; TDD
 * Milestone 9: Governments, Monetary policy).
 *
 * Pure helpers used by the EventSystem (slot #12,
 * `packages/simulation/src/systems/events.ts`):
 *
 *   - `applyEventEffects(state, event)` — apply an active event's
 *     `EventDefinition.effects` deltas to regional / global state (GDD §10.3
 *     — environmental damage creates secondary consequences). The deltas are
 *     read from content (rule 5) and scaled by a severity multiplier + global
 *     degradation (`PROVISIONAL_EVENT_SEVERITY_SCALING`). Policy-category
 *     events additionally nudge `governmentPolicy` (carbon-tax-introduced →
 *     higher carbonTaxRate; environmental-regulation-tightened → stricter
 *     environmentalRegulations; subsidy-granted → a sustainable-industry
 *     subsidy).
 *   - `updateGovernmentPolicy(state, now)` — throttled by
 *     `PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS`; the government adjusts
 *     `environmentalRegulations` + `carbonTaxRate` + subsidies based on
 *     global degradation (worse environment → tighter regulations + higher
 *     carbon tax + sustainable subsidies). Emits
 *     `government-policy-changed`.
 *   - `updateMonetaryPolicy(state, now)` — throttled by
 *     `PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS`; the central bank adjusts
 *     `interestRate` + `inflationTarget` + `moneySupplyGrowth` based on
 *     economic conditions (recession → lower rates + looser money; boom →
 *     raise rates + tighten). Emits `monetary-policy-changed`.
 *   - `severityMultiplier(severity)` — the deterministic severity →
 *     magnitude multiplier (catastrophic doubles the base delta; minor halves
 *     it). Exported for tests + future tuning.
 *
 * All helpers are pure: they return a new state (and events) without mutating
 * the input (TDD §4.1, §18.4). Deterministic given (state, params) (TDD
 * §18.3) — no RNG (the EventSystem RNG fork is DEFERRED as R-P10-N).
 *
 * DEFERRED to P10c (global markets / climate feedback / end-game objectives):
 *   - Global market trading + index evolution (the EconomySystem P10c update
 *     of `globalMarketIndices`). P10b only reads / mutates the indices as
 *     event effects; it does NOT drive market index evolution per tick.
 *   - Climate feedback loops (GHG → temperature → drought/heat/extreme
 *     weather). P10b preserves `atmosphericCarbon` / `globalTemperature` from
 *     the P7 EnvironmentSystem and does NOT close the climate feedback loop.
 *   - End-game objectives (GDD §12). The EventSystem surfaces regional
 *     collapse via `regional-condition-shifted` but does NOT evaluate
 *     win/loss conditions.
 */
import type {
  GameState,
  SimulationEvent,
  ActiveEvent,
  EventSeverity,
  GovernmentPolicy,
  MonetaryPolicy,
  RegionState,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_EVENT_SEVERITY_SCALING,
  PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS,
  PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS,
} from '@capitalist-tree/shared';
import { getEventDefinitionById } from '@capitalist-tree/content';

const SECONDS_PER_DAY = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Local @provisional policy tuning constants (GDD §17 — currency issuance
// mechanics and monetary policy; §148-152 government reactivity) — R-P10-2
// ---------------------------------------------------------------------------
// These resolve GDD §17 design decisions for the government + central-bank
// reaction functions. P10a stamped the cadence constants in
// `packages/shared/src/constants/events.ts`; the adjustment *rates* below are
// @provisional tuning values local to the simulation package (rule 10).

// PROVISIONAL (GDD §17: influence over governments + regulations)
// Fraction by which the government tightens environmental regulations / raises
// the carbon tax per unit of degradation, per policy decision cycle. 0.05 ≈
// the government moves 5% of the way toward maximum stringency per cycle when
// degradation is total. PROVISIONAL — final reactivity depends on playtesting.
const PROVISIONAL_POLICY_ADJUSTMENT_RATE = 0.05;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
// Market-index deviation (fraction from the 100 baseline) below which the
// central bank treats the economy as in recession (cuts rates). -0.1 ≈ a 10%
// commodity-basket drop triggers loosening. PROVISIONAL.
const PROVISIONAL_RECESSION_THRESHOLD = -0.1;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
// Market-index deviation above which the central bank treats the economy as
// overheating (raises rates). 0.1 ≈ a 10% rise triggers tightening.
// PROVISIONAL.
const PROVISIONAL_BOOM_THRESHOLD = 0.1;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
// Absolute change in the policy interest rate per monetary-policy decision.
// 0.01 ≈ a 1% (100 basis points) move per cycle. PROVISIONAL.
const PROVISIONAL_RATE_ADJUSTMENT = 0.01;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
// Bounds on the central-bank policy rate. PROVISIONAL.
const PROVISIONAL_RATE_FLOOR = 0.005;
const PROVISIONAL_RATE_CEILING = 0.15;

// The commodity-basket market index id used as the central bank's recession /
// boom signal (matches the index id in the content event effects).
const COMMODITY_BASKET_INDEX_ID = 'index:commodity-basket';
const MARKET_INDEX_BASELINE = 100;

/** Clamp a number into [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// severityMultiplier — deterministic severity → magnitude mapping
// ---------------------------------------------------------------------------

/**
 * Deterministic severity multiplier — maps a severity band to a 0–2 magnitude
 * multiplier applied to the content `effects` deltas (catastrophic doubles
 * the base delta; minor halves it). @provisional tuning (GDD §17 — event
 * balance). Used by `applyEventEffects` to scale an event's `effects`.
 */
export function severityMultiplier(severity: EventSeverity): number {
  switch (severity) {
    case 'minor':
      return 0.5;
    case 'moderate':
      return 1.0;
    case 'severe':
      return 1.5;
    case 'catastrophic':
      return 2.0;
  }
}

// ---------------------------------------------------------------------------
// applyEventEffects — apply an active event's content effects to state
// ---------------------------------------------------------------------------

/**
 * The set of field paths that target the global `aggregatedIndicators` block
 * (rather than a region). Effects with these paths apply to
 * `eventState.global.aggregatedIndicators` regardless of `payload.regionId`.
 */
const AGGREGATED_INDICATOR_FIELDS: ReadonlySet<string> = new Set([
  'atmosphericCarbon',
  'globalTemperature',
  'avgSoilHealth',
  'avgBiodiversity',
  'avgForestCoverage',
  'ecosystemResilience',
  'speciesExtinctionRate',
]);

/**
 * Resolve the region(s) an effect targets. If `payload.regionId` is set,
 * return a single-element list with that region; otherwise return ALL regions
 * (a region-targeted effect with no regionId is a "global" event affecting
 * every region). Returns `null` if `regionId` is set but not found.
 */
function targetRegions(
  regions: readonly RegionState[],
  payload: Record<string, unknown>,
): readonly RegionState[] | null {
  const regionId = payload['regionId'];
  if (typeof regionId === 'string' && regionId.length > 0) {
    const found = regions.filter((r) => r.id === regionId);
    return found.length > 0 ? found : null;
  }
  return regions;
}

/**
 * Apply a single effect delta to a region's nested field. Mutates `region`
 * in place (the region is already a deep-copied object). Supports the
 * `climate.<field>` and `pollution.<field>` nested paths + the top-level
 * region fields (waterAvailability, soilHealth, biodiversity, forestCoverage,
 * industrialActivity).
 */
function applyRegionDelta(region: RegionState, path: string, delta: number): void {
  if (path.startsWith('climate.')) {
    const field = path.slice('climate.'.length) as keyof RegionState['climate'];
    if (field === 'temperatureBaseline' || field === 'precipitationBaseline' || field === 'humidityBaseline') {
      region.climate[field] += delta;
    }
    return;
  }
  if (path.startsWith('pollution.')) {
    const field = path.slice('pollution.'.length) as keyof RegionState['pollution'];
    if (field === 'air' || field === 'water' || field === 'soil') {
      region.pollution[field] = Math.max(0, region.pollution[field] + delta);
    }
    return;
  }
  // Top-level region fields (0-1 indicators clamped; industrialActivity clamped;
  // others left as-is for non-indicator fields).
  switch (path) {
    case 'soilHealth':
      region.soilHealth = clamp01(region.soilHealth + delta);
      break;
    case 'waterAvailability':
      region.waterAvailability = clamp01(region.waterAvailability + delta);
      break;
    case 'biodiversity':
      region.biodiversity = clamp01(region.biodiversity + delta);
      break;
    case 'forestCoverage':
      region.forestCoverage = clamp01(region.forestCoverage + delta);
      break;
    case 'industrialActivity':
      region.industrialActivity = clamp01(region.industrialActivity + delta);
      break;
    default:
      // Unknown top-level region field — ignore (defensive).
      break;
  }
}

/**
 * Apply a policy-category event's government-policy nudge (GDD §148-152 —
 * influence over governments + regulations). Mutates `policy` in place. The
 * nudge is keyed off the event type id (the content `effects` for policy
 * events target regional industrialActivity + pollution; the governmentPolicy
 * change is a simulation-side side-effect of the policy event firing, since
 * the content authors expressed the policy intent via the event category +
 * id rather than a `governmentPolicy.*` effect path).
 *
 * @provisional mapping (GDD §17 — final policy-event → policy-field mapping
 * may move to content as `governmentPolicy.*` effect paths once the schema
 * supports nested government-policy effects).
 */
function applyPolicyNudge(
  policy: GovernmentPolicy,
  eventTypeId: string,
  multiplier: number,
): void {
  switch (eventTypeId) {
    case 'event:carbon-tax-introduced':
      policy.carbonTaxRate = clamp01(policy.carbonTaxRate + multiplier * 0.1);
      break;
    case 'event:environmental-regulation-tightened':
      policy.environmentalRegulations = clamp01(
        policy.environmentalRegulations + multiplier * 0.15,
      );
      break;
    case 'event:subsidy-granted': {
      const rate = clamp01(multiplier * 0.2);
      const subsidyType = 'subsidy:sustainable-industry';
      const existing = policy.subsidies.find((s) => s.type === subsidyType);
      if (existing) {
        existing.rate = Math.max(existing.rate, rate);
      } else {
        policy.subsidies = [...policy.subsidies, { type: subsidyType, rate }];
      }
      break;
    }
    default:
      // Non-policy event — no government-policy nudge.
      break;
  }
}

/**
 * `applyEventEffects` — apply an active event's `EventDefinition.effects`
 * deltas to regional / global state (GDD §10.3 — environmental damage creates
 * secondary consequences). Pure: returns a new state.
 *
 * Effect scaling: each content delta is multiplied by
 * `severityMultiplier(severity) * (1 + degradation * PROVISIONAL_EVENT_
 * SEVERITY_SCALING)` where `degradation = 1 - ecosystemResilience` (a
 * collapsing world amplifies event severity — GDD §10.3 feedback).
 *
 * Effect path resolution:
 *   - `globalMarketIndices.<indexId>` → `eventState.global.globalMarketIndices[indexId]`.
 *   - An `aggregatedIndicators` field (`atmosphericCarbon` / `globalTemperature`
 *     / `avgSoilHealth` / `avgBiodiversity` / `avgForestCoverage` /
 *     `ecosystemResilience` / `speciesExtinctionRate`) → the corresponding
 *     `aggregatedIndicators` field.
 *   - `climate.<field>` / `pollution.<field>` → the target region's nested
 *     field.
 *   - A top-level region field (`waterAvailability` / `soilHealth` /
 *     `biodiversity` / `forestCoverage` / `industrialActivity`) → the target
 *     region's field.
 *
 * Region targeting: if `payload.regionId` is set, region-targeted effects
 * apply to that region only; otherwise to ALL regions (a "global" event).
 * Global effects (`globalMarketIndices` / `aggregatedIndicators`) apply
 * regardless of `payload.regionId`. If `payload.regionId` is set but the
 * region does not exist, region-targeted effects are skipped (the global
 * effects still apply).
 *
 * Policy-category events additionally nudge `governmentPolicy` (see
 * `applyPolicyNudge`). Emits NO events — the caller (`triggerEventImmediate`
 * / `processScheduledEvents`) emits `event-triggered`; the next throttled
 * `updateGovernmentPolicy` emits `government-policy-changed` if the policy
 * moved further.
 */
export function applyEventEffects(
  state: GameState,
  event: ActiveEvent,
): { state: GameState; events: SimulationEvent[] } {
  const def = getEventDefinitionById(event.type);
  if (!def) {
    // Unknown type — nothing to apply. (The scheduler gate should have caught
    // this; defensive no-op here.)
    return { state, events: [] };
  }

  const resilience = state.eventState.global.aggregatedIndicators.ecosystemResilience;
  const degradation = 1 - resilience;
  const baseMultiplier = severityMultiplier(event.severity);
  const effectiveMultiplier =
    baseMultiplier * (1 + degradation * PROVISIONAL_EVENT_SEVERITY_SCALING);

  const globalMarketIndices = { ...state.eventState.global.globalMarketIndices };
  const aggregated = { ...state.eventState.global.aggregatedIndicators };
  const regions = state.eventState.global.regions.map((r) => ({
    ...r,
    climate: { ...r.climate },
    pollution: { ...r.pollution },
  }));
  const policy: GovernmentPolicy = {
    ...state.eventState.global.governmentPolicy,
    subsidies: state.eventState.global.governmentPolicy.subsidies.map((s) => ({ ...s })),
  };

  const targets = targetRegions(state.eventState.global.regions, event.payload);

  for (const [path, baseDelta] of Object.entries(def.effects)) {
    const delta = baseDelta * effectiveMultiplier;

    if (path.startsWith('globalMarketIndices.')) {
      const key = path.slice('globalMarketIndices.'.length);
      globalMarketIndices[key] = (globalMarketIndices[key] ?? MARKET_INDEX_BASELINE) + delta;
      continue;
    }
    if (AGGREGATED_INDICATOR_FIELDS.has(path)) {
      const field = path as keyof typeof aggregated;
      aggregated[field] = aggregated[field] + delta;
      // speciesExtinctionRate is nonnegative; clamp the irreversible accumulator.
      if (path === 'speciesExtinctionRate') {
        aggregated[field] = Math.max(0, aggregated[field]);
      }
      continue;
    }
    // Region-targeted effect.
    if (targets === null) {
      // regionId set but not found — skip region-targeted effects.
      continue;
    }
    for (const region of regions) {
      if (targets.some((t) => t.id === region.id)) {
        applyRegionDelta(region, path, delta);
      }
    }
  }

  // Policy-category events nudge governmentPolicy.
  if (def.category === 'policy') {
    applyPolicyNudge(policy, event.type, baseMultiplier);
  }

  // Targeted clone (P10c perf — avoids a full structuredClone per tick). Four
  // sub-paths of eventState.global are modified in one spread chain (regions +
  // aggregatedIndicators + globalMarketIndices + governmentPolicy); the rest
  // is shared by reference. Pure: the frozen input is never touched (new
  // objects at every modified level; the fresh `regions` each carry fresh
  // climate/pollution objects that `applyRegionDelta` mutates in place).
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        regions,
        aggregatedIndicators: aggregated,
        globalMarketIndices,
        governmentPolicy: policy,
      },
    },
  };

  return { state: next, events: [] };
}

// ---------------------------------------------------------------------------
// updateGovernmentPolicy — throttled government reaction (GDD §148-152)
// ---------------------------------------------------------------------------

/**
 * `updateGovernmentPolicy` — the government periodically adjusts
 * environmental regulations / carbon tax / subsidies based on aggregated
 * environmental degradation (GDD §148-152 — influence over governments +
 * regulations; GDD §6 monetary authority). Pure: returns a new state +
 * `government-policy-changed`.
 *
 * Self-throttles: a no-op when the current sim day is NOT a multiple of
 * `PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS`. When it runs:
 *
 *   - `degradation = 1 - ecosystemResilience + speciesExtinctionRate penalty`
 *     (a collapsing environment raises degradation; irreversible species loss
 *     adds a permanent penalty so the government keeps tightening).
 *   - `environmentalRegulations` tightened by `degradation * PROVISIONAL_
 *     POLICY_ADJUSTMENT_RATE`.
 *   - `carbonTaxRate` raised by `degradation * PROVISIONAL_POLICY_ADJUSTMENT_
 *     RATE * 0.5`.
 *   - If degradation is high, a `subsidy:sustainable-industry` subsidy is
 *     added / reinforced (subsidies shift to favor sustainable industries —
 *     GDD §148-152).
 *
 * Player `set-government-policy` actions can override at any time (the next
 * throttled update re-reacts to the current degradation from the overridden
 * baseline).
 */
export function updateGovernmentPolicy(
  state: GameState,
  now: number,
): { state: GameState; events: SimulationEvent[] } {
  const currentDay = Math.floor(now / SECONDS_PER_DAY);
  if (currentDay % PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS !== 0) {
    return { state, events: [] };
  }
  // Skip the first day (day 0) — let the regional indicators settle one cycle
  // before the government reacts, so a freshly-seeded world isn't immediately
  // regulated. (Deterministic — `currentDay === 0` is a fixed gate.)
  if (currentDay === 0) {
    return { state, events: [] };
  }

  const indicators = state.eventState.global.aggregatedIndicators;
  let degradation = 1 - indicators.ecosystemResilience;
  // Irreversible species loss adds a permanent degradation penalty.
  degradation += Math.min(0.3, indicators.speciesExtinctionRate * 0.1);
  degradation = clamp01(degradation);

  const policy: GovernmentPolicy = {
    ...state.eventState.global.governmentPolicy,
    subsidies: state.eventState.global.governmentPolicy.subsidies.map((s) => ({ ...s })),
  };

  policy.environmentalRegulations = clamp01(
    policy.environmentalRegulations + degradation * PROVISIONAL_POLICY_ADJUSTMENT_RATE,
  );
  policy.carbonTaxRate = clamp01(
    policy.carbonTaxRate + degradation * PROVISIONAL_POLICY_ADJUSTMENT_RATE * 0.5,
  );

  // High degradation → reinforce the sustainable-industry subsidy.
  if (degradation > 0.4) {
    const rate = clamp01(degradation * 0.3);
    const subsidyType = 'subsidy:sustainable-industry';
    const existing = policy.subsidies.find((s) => s.type === subsidyType);
    if (existing) {
      existing.rate = Math.max(existing.rate, rate);
    } else {
      policy.subsidies = [...policy.subsidies, { type: subsidyType, rate }];
    }
  }

  // Targeted clone (P10c perf — avoids a full structuredClone per tick). Only
  // the eventState.global.governmentPolicy path is cloned; the rest of the
  // state is shared by reference. Pure: the frozen input is never touched.
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        governmentPolicy: policy,
      },
    },
  };

  const event: SimulationEvent = {
    type: 'government-policy-changed',
    at: now,
    payload: { policy },
  };

  return { state: next, events: [event] };
}

// ---------------------------------------------------------------------------
// updateMonetaryPolicy — throttled central-bank reaction (GDD §404-408)
// ---------------------------------------------------------------------------

/**
 * `updateMonetaryPolicy` — the central bank periodically adjusts the policy
 * interest rate / inflation target / money-supply growth based on economic
 * conditions (GDD §404-408 monetary authority + monetary policy tools).
 * Pure: returns a new state + `monetary-policy-changed`.
 *
 * Self-throttles: a no-op when the current sim day is NOT a multiple of
 * `PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS`. When it runs:
 *
 *   - Reads the `index:commodity-basket` global market index (default 100 if
 *     absent) as the recession / boom signal.
 *   - `deviation = (marketIndex - 100) / 100`. If `deviation <
 *     PROVISIONAL_RECESSION_THRESHOLD` → recession → cut the policy rate by
 *     `PROVISIONAL_RATE_ADJUSTMENT`, lower the inflation target, loosen money
 *     supply growth. If `deviation > PROVISIONAL_BOOM_THRESHOLD` → boom →
 *     raise the rate, raise the inflation target, tighten money supply.
 *   - No market signal (index absent + no deviation) → policy holds (no
 *     change, no event).
 *
 * P10b reads the market index as set by event effects (market-crash /
 * resource-scarcity / boom) — P10c will drive per-tick market index evolution
 * via the EconomySystem global-markets update. Player `set-monetary-policy`
 * actions can override at any time.
 */
export function updateMonetaryPolicy(
  state: GameState,
  now: number,
): { state: GameState; events: SimulationEvent[] } {
  const currentDay = Math.floor(now / SECONDS_PER_DAY);
  if (currentDay % PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS !== 0) {
    return { state, events: [] };
  }
  if (currentDay === 0) {
    return { state, events: [] };
  }

  const marketIndex =
    state.eventState.global.globalMarketIndices[COMMODITY_BASKET_INDEX_ID] ??
    MARKET_INDEX_BASELINE;
  const deviation = (marketIndex - MARKET_INDEX_BASELINE) / MARKET_INDEX_BASELINE;

  // No market signal → policy holds.
  if (
    deviation > PROVISIONAL_RECESSION_THRESHOLD &&
    deviation < PROVISIONAL_BOOM_THRESHOLD
  ) {
    return { state, events: [] };
  }

  const policy: MonetaryPolicy = { ...state.eventState.global.monetaryPolicy };

  if (deviation <= PROVISIONAL_RECESSION_THRESHOLD) {
    // Recession — cut rates + loosen money.
    policy.interestRate = Math.max(
      PROVISIONAL_RATE_FLOOR,
      policy.interestRate - PROVISIONAL_RATE_ADJUSTMENT,
    );
    policy.inflationTarget = Math.max(0.005, policy.inflationTarget - 0.005);
    policy.moneySupplyGrowth = Math.min(0.08, policy.moneySupplyGrowth + 0.01);
  } else if (deviation >= PROVISIONAL_BOOM_THRESHOLD) {
    // Boom — raise rates + tighten money.
    policy.interestRate = Math.min(
      PROVISIONAL_RATE_CEILING,
      policy.interestRate + PROVISIONAL_RATE_ADJUSTMENT,
    );
    policy.inflationTarget = Math.min(0.05, policy.inflationTarget + 0.005);
    policy.moneySupplyGrowth = Math.max(0.01, policy.moneySupplyGrowth - 0.005);
  }

  // Targeted clone (P10c perf — avoids a full structuredClone per tick). Only
  // the eventState.global.monetaryPolicy path is cloned; the rest of the state
  // is shared by reference. Pure: the frozen input is never touched.
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        monetaryPolicy: policy,
      },
    },
  };

  const event: SimulationEvent = {
    type: 'monetary-policy-changed',
    at: now,
    payload: { policy },
  };

  return { state: next, events: [event] };
}

/**
 * Read-only access to the @provisional policy tuning constants for tests +
 * future tuning promotion.
 */
export const POLICY_CONSTANTS = {
  PROVISIONAL_POLICY_ADJUSTMENT_RATE,
  PROVISIONAL_RECESSION_THRESHOLD,
  PROVISIONAL_BOOM_THRESHOLD,
  PROVISIONAL_RATE_ADJUSTMENT,
  PROVISIONAL_RATE_FLOOR,
  PROVISIONAL_RATE_CEILING,
  COMMODITY_BASKET_INDEX_ID,
  MARKET_INDEX_BASELINE,
} as const;
