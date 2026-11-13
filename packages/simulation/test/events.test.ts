/**
 * EventSystem module unit + integration tests (P10b — TDD §18.1, §18.4; TDD
 * §6.4 Event Scheduling, line 200 EventSystem; GDD §10 Environment and
 * Climate, §148-152 influence over regional/global markets/governments/
 * regulations, §404-408 monetary authority).
 *
 * Asserts the invariants the GDD and TDD require:
 *
 *   - Scheduler: scheduleEvent adds to queue with correct id/priority;
 *     processScheduledEvents fires due events (scheduledAt <= currentTick),
 *     moves to active, applies effects; expires active events when
 *     remaining <= 0; cancelScheduledEvent removes from queue;
 *     triggerEventImmediate bypasses queue; resolveActiveEvent resolves
 *     early. Throttled by PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS.
 *   - Regional: evolveRegions drifts indicators (pollution accumulates from
 *     industrialActivity, soil/water/biodiversity recover at
 *     PROVISIONAL_EVENT_RECOVERY_RATE); species extinction irreversible
 *     below threshold; aggregateGlobalIndicators computes weighted averages
 *     + tracks min regional values.
 *   - Global: updateGovernmentPolicy tightens regulations when degradation
 *     high (throttled); updateMonetaryPolicy lowers rates in recession
 *     (throttled); applyEventEffects applies the correct state changes for
 *     each event type (drought → waterAvailability, market-crash →
 *     globalMarketIndices, carbon-tax → governmentPolicy, etc.).
 *   - Actions: schedule-event (success), cancel-event, trigger-event,
 *     resolve-event, set-government-policy, set-monetary-policy.
 *   - Determinism: same seed → same event sequence.
 *   - Purity: input not mutated (freeze test).
 *   - RNG fork DEFERRED (R-P10-N): EventSystem at slot #12 does NOT fork
 *     'events' — the persisted rngState accumulates every per-step fork, so a
 *     fork here would shift the BiologySystem (#3) + AutomationSystem (#9)
 *     child seeds at every subsequent tick. Verified by the zero-root-draw +
 *     starved-tree-still-dies-equivalent tests.
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  eventSystem,
  defaultRegistry,
  defaultSystems,
  scheduleEvent,
  cancelScheduledEvent,
  triggerEventImmediate,
  resolveActiveEvent,
  processScheduledEvents,
  seedDefaultRegions,
  evolveRegions,
  aggregateGlobalIndicators,
  minRegionalIndicators,
  applyEventEffects,
  updateGovernmentPolicy,
  updateMonetaryPolicy,
  severityMultiplier,
  UnknownEventDefinitionError,
  UnknownActiveEventError,
  DEFAULT_REGION_IDS,
  ECOSYSTEM_RESILIENCE_WEIGHTS,
} from '../src/index.js';
import type { SystemContext, GameState, ActiveEvent } from '../src/index.js';
import { Rng } from '../src/rng.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { DROUGHT } from '@capitalist-tree/content';
import {
  type GameConfig,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
  PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS,
  PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS,
  PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD,
} from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const STEP = PROVISIONAL_SIMULATION_STEP_SECONDS; // 60 sim seconds / tick
const SECONDS_PER_DAY = 24 * 60 * 60;
const DAY = SECONDS_PER_DAY;

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

/** Fresh GameState from a seed. */
function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

/** A state with the @provisional default regions seeded (for effect / drift tests). */
function stateWithRegions(seed = 42): GameState {
  return seedDefaultRegions(freshState(seed));
}

/** Deep-freeze an object so any mutation throws (purity test). */
function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  Object.freeze(v);
  if (Array.isArray(v)) {
    for (const item of v) deepFreeze(item);
  } else {
    for (const key of Object.keys(v as Record<string, unknown>)) {
      deepFreeze((v as Record<string, unknown>)[key]);
    }
  }
  return v;
}

/** Build a SystemContext for a single step at `now` (sim seconds). */
function ctxAt(state: GameState, now: number): SystemContext {
  return {
    now,
    stepSeconds: STEP,
    dayOfYear: state.clock.day,
    rng: Rng.fromState(state.rngState),
  };
}

/** Convert a tick index to the sim-second `now` value the helpers expect. */
function nowAtTick(tick: number): number {
  return tick * STEP;
}

/** Find a region by id on the state. */
function regionById(state: GameState, id: string) {
  return state.eventState.global.regions.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Registry position — slot #12 (the LAST system; all 12 now real)
// ---------------------------------------------------------------------------

describe('registry position — EventSystem is slot #12 (the LAST system)', () => {
  it('defaultSystems has EventSystem at index 11 (slot #12)', () => {
    expect(defaultSystems[11]?.id).toBe('EventSystem');
  });

  it('defaultRegistry.all()[11] is EventSystem', () => {
    expect(defaultRegistry.all()[11]?.id).toBe('EventSystem');
  });

  it('defaultRegistry.ids() lists EventSystem after ProgressionSystem (slot #11 → #12)', () => {
    const ids = defaultRegistry.ids();
    expect(ids).toHaveLength(12);
    const progIdx = ids.indexOf('ProgressionSystem');
    const eventIdx = ids.indexOf('EventSystem');
    expect(progIdx).toBe(10);
    expect(eventIdx).toBe(11);
    expect(eventIdx).toBe(progIdx + 1);
  });

  it('the EventSystem is a real implementation (NOT the noopSystem stub)', () => {
    // The stub returned state unchanged + emitted no events. A real
    // EventSystem on a fresh state seeds regions (first tick) — so the
    // returned state has a non-empty regions list + at least one tick event
    // is NOT required, but regions MUST be seeded.
    const initial = freshState(42);
    const ctx = ctxAt(initial, initial.clock.elapsedSeconds + STEP);
    const result = eventSystem.execute(initial, ctx);
    expect(result.state.eventState.global.regions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scheduler — scheduleEvent / cancelScheduledEvent
// ---------------------------------------------------------------------------

describe('scheduler — scheduleEvent', () => {
  it('adds a ScheduledEventInstance to the queue with a deterministic id + priority', () => {
    const state = freshState();
    const result = scheduleEvent(state, 'event:drought', 120, {}, 'high', 0);
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(1);
    const inst = result.state.eventState.scheduler.scheduled[0]!;
    expect(inst.id).toBe('evt-0');
    expect(inst.type).toBe('event:drought');
    expect(inst.scheduledAt).toBe(120);
    expect(inst.priority).toBe('high');
    expect(inst.resolved).toBe(false);
    expect(result.state.eventState.scheduler.nextEventId).toBe(1);
  });

  it('increments nextEventId across multiple scheduleEvent calls (deterministic ids)', () => {
    const state = freshState();
    let s = state;
    s = scheduleEvent(s, 'event:drought', 0, {}, 'normal', 0).state;
    s = scheduleEvent(s, 'event:heat-wave', 60, {}, 'normal', 0).state;
    const ids = s.eventState.scheduler.scheduled.map((e) => e.id);
    expect(ids).toEqual(['evt-0', 'evt-1']);
    expect(s.eventState.scheduler.nextEventId).toBe(2);
  });

  it('emits an event-scheduled event carrying the allocated id + fire tick', () => {
    const state = freshState();
    const result = scheduleEvent(state, 'event:drought', 120, { regionId: 'region:arid-highlands' }, 'normal', 1000);
    expect(result.events).toHaveLength(1);
    const ev = result.events[0]!;
    expect(ev.type).toBe('event-scheduled');
    expect(ev.at).toBe(1000);
    expect(ev.payload).toMatchObject({
      eventId: 'evt-0',
      eventTypeId: 'event:drought',
      scheduledAt: 120,
      priority: 'normal',
    });
  });

  it('throws UnknownEventDefinitionError for an unknown event type id', () => {
    const state = freshState();
    expect(() => scheduleEvent(state, 'event:does-not-exist', 0, {}, 'normal', 0)).toThrow(
      UnknownEventDefinitionError,
    );
  });

  it('does not mutate the input state (purity)', () => {
    const state = deepFreeze(structuredClone(freshState()));
    const result = scheduleEvent(state, 'event:drought', 0, {}, 'normal', 0);
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(1);
    // The frozen input is untouched (no throw → no mutation).
    expect(state.eventState.scheduler.scheduled).toHaveLength(0);
  });
});

describe('scheduler — cancelScheduledEvent', () => {
  it('removes a scheduled event by id', () => {
    const state = scheduleEvent(freshState(), 'event:drought', 120, {}, 'normal', 0).state;
    const result = cancelScheduledEvent(state, 'evt-0');
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(0);
  });

  it('is idempotent — a missing id is a no-op (no throw, no state change to the list)', () => {
    const state = scheduleEvent(freshState(), 'event:drought', 120, {}, 'normal', 0).state;
    const before = state.eventState.scheduler.scheduled.length;
    const result = cancelScheduledEvent(state, 'evt-does-not-exist');
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(before);
    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scheduler — processScheduledEvents (throttled firing + expiry)
// ---------------------------------------------------------------------------

describe('scheduler — processScheduledEvents', () => {
  it('is throttled — a no-op when the current tick is NOT a multiple of the interval', () => {
    const state = scheduleEvent(freshState(), 'event:drought', 0, {}, 'normal', 0).state;
    // tick 30 (30 % 60 !== 0) → no-op.
    const result = processScheduledEvents(state, nowAtTick(30));
    expect(result.state).toBe(state);
    expect(result.events).toHaveLength(0);
  });

  it('fires due scheduled events (scheduledAt <= currentTick) on a check tick', () => {
    const state = scheduleEvent(freshState(), 'event:drought', 0, {}, 'normal', 0).state;
    const result = processScheduledEvents(state, nowAtTick(0));
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(0);
    expect(result.state.eventState.scheduler.active).toHaveLength(1);
    const active = result.state.eventState.scheduler.active[0]!;
    expect(active.type).toBe('event:drought');
    expect(active.startedAt).toBe(0);
    expect(active.remaining).toBe(active.duration);
    expect(result.events.some((e) => e.type === 'event-triggered')).toBe(true);
  });

  it('leaves not-yet-due scheduled events in the queue', () => {
    const state = scheduleEvent(freshState(), 'event:drought', 120, {}, 'normal', 0).state;
    const result = processScheduledEvents(state, nowAtTick(0));
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(1);
    expect(result.state.eventState.scheduler.active).toHaveLength(0);
  });

  it('expires active events when remaining <= 0 (retires to history with outcome expired)', () => {
    // Trigger an event with a short explicit duration, then run a check tick
    // that decrements its remaining to <= 0.
    let state = stateWithRegions();
    state = triggerEventImmediate(state, 'event:drought', { duration: 60 }, 0).state;
    const activeId = state.eventState.scheduler.active[0]!.id;
    // tick 60 check: decrement remaining (60) by interval (60) → 0 → expire.
    const result = processScheduledEvents(state, nowAtTick(60));
    expect(result.state.eventState.scheduler.active).toHaveLength(0);
    expect(result.state.eventState.scheduler.history).toHaveLength(1);
    const hist = result.state.eventState.scheduler.history[0]!;
    expect(hist.id).toBe(activeId);
    expect(hist.outcome).toBe('expired');
    expect(result.events.some((e) => e.type === 'event-expired')).toBe(true);
  });

  it('keeps active events whose remaining is still > 0 after a check (decrements by the interval)', () => {
    let state = stateWithRegions();
    state = triggerEventImmediate(state, 'event:drought', { duration: 120 }, 0).state;
    // tick 60 check: decrement 120 by 60 → 60 remaining → still active.
    const result = processScheduledEvents(state, nowAtTick(60));
    expect(result.state.eventState.scheduler.active).toHaveLength(1);
    expect(result.state.eventState.scheduler.active[0]!.remaining).toBe(60);
    expect(result.state.eventState.scheduler.history).toHaveLength(0);
  });

  it('fires due events in priority order (critical before normal) within a check', () => {
    let state = freshState();
    state = scheduleEvent(state, 'event:drought', 0, {}, 'normal', 0).state;
    state = scheduleEvent(state, 'event:heat-wave', 0, {}, 'critical', 0).state;
    const result = processScheduledEvents(state, nowAtTick(0));
    const triggered = result.events.filter((e) => e.type === 'event-triggered');
    expect(triggered).toHaveLength(2);
    // critical (heat-wave) fires before normal (drought).
    expect(triggered[0]!.payload.eventTypeId).toBe('event:heat-wave');
    expect(triggered[1]!.payload.eventTypeId).toBe('event:drought');
  });
});

// ---------------------------------------------------------------------------
// Scheduler — triggerEventImmediate + resolveActiveEvent
// ---------------------------------------------------------------------------

describe('scheduler — triggerEventImmediate', () => {
  it('bypasses the queue — moves straight to active + emits event-triggered', () => {
    const state = stateWithRegions();
    const result = triggerEventImmediate(state, 'event:drought', {}, 0);
    expect(result.state.eventState.scheduler.active).toHaveLength(1);
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('event-triggered');
  });

  it('resolves severity from payload.severity; defaults to moderate when omitted', () => {
    const state = stateWithRegions();
    const explicit = triggerEventImmediate(state, 'event:drought', { severity: 'catastrophic' }, 0);
    expect(explicit.state.eventState.scheduler.active[0]!.severity).toBe('catastrophic');
    const defaulted = triggerEventImmediate(state, 'event:drought', {}, 0);
    expect(defaulted.state.eventState.scheduler.active[0]!.severity).toBe('moderate');
  });

  it('resolves duration as the midpoint of the definition durationRange when not in payload', () => {
    const state = stateWithRegions();
    const result = triggerEventImmediate(state, 'event:drought', {}, 0);
    const [min, max] = DROUGHT.durationRange;
    const expectedMid = Math.floor((min + max) / 2);
    expect(result.state.eventState.scheduler.active[0]!.duration).toBe(expectedMid);
  });

  it('throws UnknownEventDefinitionError for an unknown event type id', () => {
    const state = stateWithRegions();
    expect(() => triggerEventImmediate(state, 'event:does-not-exist', {}, 0)).toThrow(
      UnknownEventDefinitionError,
    );
  });
});

describe('scheduler — resolveActiveEvent', () => {
  it('resolves an active event early — retires to history with outcome mitigated + emits event-resolved', () => {
    let state = stateWithRegions();
    state = triggerEventImmediate(state, 'event:drought', {}, 0).state;
    const activeId = state.eventState.scheduler.active[0]!.id;
    const result = resolveActiveEvent(state, activeId, nowAtTick(5));
    expect(result.state.eventState.scheduler.active).toHaveLength(0);
    expect(result.state.eventState.scheduler.history).toHaveLength(1);
    expect(result.state.eventState.scheduler.history[0]!.outcome).toBe('mitigated');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('event-resolved');
    expect(result.events[0]!.payload.outcome).toBe('mitigated');
  });

  it('throws UnknownActiveEventError for an id that is not active', () => {
    const state = stateWithRegions();
    expect(() => resolveActiveEvent(state, 'evt-does-not-exist', 0)).toThrow(UnknownActiveEventError);
  });
});

// ---------------------------------------------------------------------------
// Regional — seedDefaultRegions / evolveRegions / aggregateGlobalIndicators
// ---------------------------------------------------------------------------

describe('regional — seedDefaultRegions', () => {
  it('seeds the @provisional default biomes on a fresh state (regions empty → 4 regions)', () => {
    const state = freshState();
    expect(state.eventState.global.regions).toHaveLength(0);
    const seeded = seedDefaultRegions(state);
    expect(seeded.eventState.global.regions).toHaveLength(DEFAULT_REGION_IDS.length);
    const ids = seeded.eventState.global.regions.map((r) => r.id);
    expect(ids).toEqual([...DEFAULT_REGION_IDS]);
  });

  it('is idempotent — a non-empty regions list is preserved verbatim', () => {
    const seeded = seedDefaultRegions(freshState());
    const again = seedDefaultRegions(seeded);
    expect(again).toBe(seeded);
  });
});

describe('regional — evolveRegions', () => {
  it('pollution accumulates from industrialActivity over time', () => {
    const state = stateWithRegions();
    const before = regionById(state, 'region:temperate-lowlands')!;
    const result = evolveRegions(state, DAY * 10);
    const after = regionById(result.state, 'region:temperate-lowlands')!;
    // industrialActivity 0.5 → pollution.air should grow over 10 days.
    expect(after.pollution.air).toBeGreaterThan(before.pollution.air);
  });

  it('soilHealth / waterAvailability / biodiversity / forestCoverage drift (recover when pollution low + industry idle)', () => {
    // Inject a pristine region (industrialActivity 0, low pollution) so
    // recovery dominates: soilHealth (0.5) should recover toward 1 over time.
    const state = stateWithRegions();
    const pristine: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          regions: state.eventState.global.regions.map((r) =>
            r.id === 'region:boreal-taiga'
              ? {
                  ...r,
                  industrialActivity: 0,
                  pollution: { air: 1, water: 1, soil: 1 },
                  soilHealth: 0.5,
                  waterAvailability: 0.5,
                  biodiversity: 0.5,
                  forestCoverage: 0.5,
                }
              : r,
          ),
        },
      },
    };
    const before = regionById(pristine, 'region:boreal-taiga')!;
    const result = evolveRegions(pristine, DAY * 50);
    const after = regionById(result.state, 'region:boreal-taiga')!;
    expect(after.soilHealth).toBeGreaterThan(before.soilHealth);
    expect(after.waterAvailability).toBeGreaterThan(before.waterAvailability);
  });

  it('degrades soilHealth when pollution stress is high', () => {
    // arid-highlands: industrialActivity 0.4 → heavy pollution accumulation
    // over 100 days drives pollution stress above recovery → soilHealth drops.
    const state = stateWithRegions();
    const before = regionById(state, 'region:arid-highlands')!.soilHealth;
    const result = evolveRegions(state, DAY * 100);
    const after = regionById(result.state, 'region:arid-highlands')!.soilHealth;
    expect(after).toBeLessThan(before);
  });

  it('species extinction is irreversible below the threshold (biodiversity does NOT recover + speciesExtinctionRate ratchets up)', () => {
    // Inject a region with biodiversity below the extinction threshold.
    const state = stateWithRegions();
    const collapsing = {
      ...regionById(state, 'region:arid-highlands')!,
      biodiversity: PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD - 0.05,
    };
    const injected: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          regions: state.eventState.global.regions.map((r) =>
            r.id === collapsing.id ? collapsing : r,
          ),
        },
      },
    };
    const extinctionBefore = injected.eventState.global.aggregatedIndicators.speciesExtinctionRate;
    const beforeBio = collapsing.biodiversity;
    const result = evolveRegions(injected, DAY * 10);
    const afterBio = regionById(result.state, 'region:arid-highlands')!.biodiversity;
    // Biodiversity does NOT recover (it can only stay or drop further).
    expect(afterBio).toBeLessThanOrEqual(beforeBio);
    // speciesExtinctionRate ratcheted up.
    expect(result.state.eventState.global.aggregatedIndicators.speciesExtinctionRate).toBeGreaterThan(
      extinctionBefore,
    );
  });

  it('is a no-op when dtSeconds <= 0 or regions empty', () => {
    const empty = freshState();
    expect(evolveRegions(empty, DAY).state).toBe(empty);
    const seeded = stateWithRegions();
    expect(evolveRegions(seeded, 0).state).toBe(seeded);
  });

  it('emits regional-condition-shifted when an indicator crosses a threshold', () => {
    // Inject a region with waterAvailability just above 0.3, then drive a
    // drought effect that drops it below 0.3 via evolveRegions pollution
    // stress — OR more directly, set up a region that will cross 0.3 under
    // heavy pollution.
    const state = stateWithRegions();
    // arid-highlands waterAvailability is 0.3 exactly — set to 0.31 so a
    // small drop crosses 0.3.
    const tweaked: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          regions: state.eventState.global.regions.map((r) =>
            r.id === 'region:arid-highlands' ? { ...r, waterAvailability: 0.31 } : r,
          ),
        },
      },
    };
    // Heavy pollution accumulation over 200 days drops waterAvailability
    // below 0.3 → crosses the threshold.
    const result = evolveRegions(tweaked, DAY * 200);
    const shifted = result.events.filter((e) => e.type === 'regional-condition-shifted');
    expect(shifted.length).toBeGreaterThan(0);
    const waterShift = shifted.find(
      (e) => e.type === 'regional-condition-shifted' && e.payload.field === 'waterAvailability',
    );
    expect(waterShift).toBeDefined();
  });

  it('does not mutate the input state (purity)', () => {
    const state = deepFreeze(structuredClone(stateWithRegions()));
    const result = evolveRegions(state, DAY);
    // Ran without throwing on the frozen input → no mutation.
    expect(result.state.eventState.global.regions.length).toBeGreaterThan(0);
  });
});

describe('regional — aggregateGlobalIndicators', () => {
  it('computes population-weighted averages from regional conditions', () => {
    const state = stateWithRegions();
    const result = aggregateGlobalIndicators(state);
    const regions = state.eventState.global.regions;
    const totalPop = regions.reduce((a, r) => a + r.population, 0);
    const expectedAvgSoil =
      regions.reduce((a, r) => a + r.soilHealth * r.population, 0) / totalPop;
    expect(result.state.eventState.global.aggregatedIndicators.avgSoilHealth).toBeCloseTo(
      expectedAvgSoil,
      6,
    );
  });

  it('computes ecosystemResilience as the @provisional composite (0.5 bio + 0.3 forest + 0.2 soil)', () => {
    const state = stateWithRegions();
    const result = aggregateGlobalIndicators(state);
    const agg = result.state.eventState.global.aggregatedIndicators;
    const expected =
      ECOSYSTEM_RESILIENCE_WEIGHTS.biodiversity * agg.avgBiodiversity +
      ECOSYSTEM_RESILIENCE_WEIGHTS.forestCoverage * agg.avgForestCoverage +
      ECOSYSTEM_RESILIENCE_WEIGHTS.soilHealth * agg.avgSoilHealth;
    expect(agg.ecosystemResilience).toBeCloseTo(expected, 6);
  });

  it('tracks min regional values alongside the averages (collapsing local ecosystem visible)', () => {
    const state = stateWithRegions();
    const result = aggregateGlobalIndicators(state);
    expect(result.minIndicators).not.toBeNull();
    const directMin = minRegionalIndicators(state)!;
    expect(result.minIndicators?.soilHealth).toBe(directMin.soilHealth);
    expect(result.minIndicators?.biodiversity).toBe(directMin.biodiversity);
    // The min biodiversity is <= the average (a healthy average must not
    // conceal a collapsing local ecosystem — GDD §10.2).
    expect(result.minIndicators!.biodiversity).toBeLessThanOrEqual(
      result.state.eventState.global.aggregatedIndicators.avgBiodiversity,
    );
  });

  it('preserves atmosphericCarbon / globalTemperature / speciesExtinctionRate (not recomputed here)', () => {
    const state = stateWithRegions();
    const carbonBefore = state.eventState.global.aggregatedIndicators.atmosphericCarbon;
    const tempBefore = state.eventState.global.aggregatedIndicators.globalTemperature;
    const extBefore = state.eventState.global.aggregatedIndicators.speciesExtinctionRate;
    const result = aggregateGlobalIndicators(state);
    expect(result.state.eventState.global.aggregatedIndicators.atmosphericCarbon).toBe(carbonBefore);
    expect(result.state.eventState.global.aggregatedIndicators.globalTemperature).toBe(tempBefore);
    expect(result.state.eventState.global.aggregatedIndicators.speciesExtinctionRate).toBe(extBefore);
  });

  it('is a no-op when regions empty (returns minIndicators null)', () => {
    const state = freshState();
    const result = aggregateGlobalIndicators(state);
    expect(result.state).toBe(state);
    expect(result.minIndicators).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Global — applyEventEffects / updateGovernmentPolicy / updateMonetaryPolicy
// ---------------------------------------------------------------------------

describe('global — applyEventEffects', () => {
  it('drought reduces the target region waterAvailability (severity-scaled)', () => {
    const state = stateWithRegions();
    const before = regionById(state, 'region:arid-highlands')!.waterAvailability;
    // Build an active event manually + apply (triggerEventImmediate wraps this).
    const active: ActiveEvent = {
      id: 'test-1',
      type: 'event:drought',
      startedAt: 0,
      duration: 30,
      remaining: 30,
      payload: { regionId: 'region:arid-highlands', severity: 'severe' },
      severity: 'severe',
    };
    const result = applyEventEffects(state, active);
    const after = regionById(result.state, 'region:arid-highlands')!.waterAvailability;
    expect(after).toBeLessThan(before);
  });

  it('a region-targeted event with a regionId does NOT affect other regions', () => {
    const state = stateWithRegions();
    const before = regionById(state, 'region:temperate-lowlands')!.waterAvailability;
    const active: ActiveEvent = {
      id: 'test-1',
      type: 'event:drought',
      startedAt: 0,
      duration: 30,
      remaining: 30,
      payload: { regionId: 'region:arid-highlands', severity: 'severe' },
      severity: 'severe',
    };
    const result = applyEventEffects(state, active);
    const after = regionById(result.state, 'region:temperate-lowlands')!.waterAvailability;
    expect(after).toBe(before);
  });

  it('a region-targeted event with NO regionId applies to ALL regions', () => {
    const state = stateWithRegions();
    const beforeLow = regionById(state, 'region:temperate-lowlands')!.waterAvailability;
    const active: ActiveEvent = {
      id: 'test-1',
      type: 'event:drought',
      startedAt: 0,
      duration: 30,
      remaining: 30,
      payload: { severity: 'severe' },
      severity: 'severe',
    };
    const result = applyEventEffects(state, active);
    const afterLow = regionById(result.state, 'region:temperate-lowlands')!.waterAvailability;
    expect(afterLow).toBeLessThan(beforeLow);
  });

  it('market-crash reduces the global commodity-basket market index', () => {
    const state = stateWithRegions();
    const active: ActiveEvent = {
      id: 'test-1',
      type: 'event:market-crash',
      startedAt: 0,
      duration: 30,
      remaining: 30,
      payload: { severity: 'moderate' },
      severity: 'moderate',
    };
    const result = applyEventEffects(state, active);
    const idx = result.state.eventState.global.globalMarketIndices['index:commodity-basket'];
    expect(idx).toBeDefined();
    expect(idx!).toBeLessThan(100); // baseline 100, delta negative.
  });

  it('carbon-tax-introduced nudges governmentPolicy.carbonTaxRate up (policy-category side-effect)', () => {
    const state = stateWithRegions();
    const before = state.eventState.global.governmentPolicy.carbonTaxRate;
    const active: ActiveEvent = {
      id: 'test-1',
      type: 'event:carbon-tax-introduced',
      startedAt: 0,
      duration: 120,
      remaining: 120,
      payload: { severity: 'moderate' },
      severity: 'moderate',
    };
    const result = applyEventEffects(state, active);
    expect(result.state.eventState.global.governmentPolicy.carbonTaxRate).toBeGreaterThan(before);
  });

  it('scales effects by severityMultiplier (catastrophic > minor for the same event)', () => {
    const state = stateWithRegions();
    const minorEvent: ActiveEvent = {
      id: 'test-minor',
      type: 'event:drought',
      startedAt: 0,
      duration: 30,
      remaining: 30,
      payload: { regionId: 'region:arid-highlands', severity: 'minor' },
      severity: 'minor',
    };
    const catEvent: ActiveEvent = {
      id: 'test-cat',
      type: 'event:drought',
      startedAt: 0,
      duration: 30,
      remaining: 30,
      payload: { regionId: 'region:arid-highlands', severity: 'catastrophic' },
      severity: 'catastrophic',
    };
    const minorResult = applyEventEffects(state, minorEvent);
    const catResult = applyEventEffects(state, catEvent);
    const minorDrop = beforeWater(state) - afterWater(minorResult.state);
    const catDrop = beforeWater(state) - afterWater(catResult.state);
    expect(catDrop).toBeGreaterThan(minorDrop);
  });

  function beforeWater(s: GameState): number {
    return regionById(s, 'region:arid-highlands')!.waterAvailability;
  }
  function afterWater(s: GameState): number {
    return regionById(s, 'region:arid-highlands')!.waterAvailability;
  }

  it('severityMultiplier maps bands correctly (minor 0.5 → catastrophic 2.0)', () => {
    expect(severityMultiplier('minor')).toBe(0.5);
    expect(severityMultiplier('moderate')).toBe(1.0);
    expect(severityMultiplier('severe')).toBe(1.5);
    expect(severityMultiplier('catastrophic')).toBe(2.0);
  });

  it('does not mutate the input state (purity)', () => {
    const state = deepFreeze(structuredClone(stateWithRegions()));
    const active: ActiveEvent = {
      id: 'test-1',
      type: 'event:drought',
      startedAt: 0,
      duration: 30,
      remaining: 30,
      payload: { regionId: 'region:arid-highlands', severity: 'severe' },
      severity: 'severe',
    };
    const result = applyEventEffects(state, active);
    expect(result.state.eventState.global.regions.length).toBeGreaterThan(0);
  });
});

describe('global — updateGovernmentPolicy', () => {
  it('is throttled — a no-op when the current day is NOT a multiple of the interval', () => {
    const state = stateWithRegions();
    // day 15 (15 % 30 !== 0) → no-op.
    const result = updateGovernmentPolicy(state, 15 * DAY);
    expect(result.state).toBe(state);
    expect(result.events).toHaveLength(0);
  });

  it('tightens environmentalRegulations + raises carbonTaxRate when degradation is high (throttled, day 30)', () => {
    // Inject a degraded world: low ecosystemResilience + nonzero extinction.
    const state = stateWithRegions();
    const degraded: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          aggregatedIndicators: {
            ...state.eventState.global.aggregatedIndicators,
            ecosystemResilience: 0.2, // degradation = 0.8
            speciesExtinctionRate: 1.0,
          },
        },
      },
    };
    const beforeRegs = degraded.eventState.global.governmentPolicy.environmentalRegulations;
    const beforeTax = degraded.eventState.global.governmentPolicy.carbonTaxRate;
    const result = updateGovernmentPolicy(degraded, PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS * DAY);
    expect(
      result.state.eventState.global.governmentPolicy.environmentalRegulations,
    ).toBeGreaterThan(beforeRegs);
    expect(result.state.eventState.global.governmentPolicy.carbonTaxRate).toBeGreaterThan(beforeTax);
    expect(result.events.some((e) => e.type === 'government-policy-changed')).toBe(true);
  });

  it('skips the first day (day 0) so a freshly-seeded world is not immediately regulated', () => {
    const state = stateWithRegions();
    const result = updateGovernmentPolicy(state, 0);
    expect(result.state).toBe(state);
    expect(result.events).toHaveLength(0);
  });
});

describe('global — updateMonetaryPolicy', () => {
  it('is throttled — a no-op when the current day is NOT a multiple of the interval', () => {
    const state = stateWithRegions();
    const result = updateMonetaryPolicy(state, 15 * DAY);
    expect(result.state).toBe(state);
    expect(result.events).toHaveLength(0);
  });

  it('lowers interestRate in a recession (commodity-basket below baseline, day 30)', () => {
    const state = stateWithRegions();
    const recession: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 80 }, // -20% → recession
        },
      },
    };
    const before = recession.eventState.global.monetaryPolicy.interestRate;
    const result = updateMonetaryPolicy(recession, PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS * DAY);
    expect(result.state.eventState.global.monetaryPolicy.interestRate).toBeLessThan(before);
    expect(result.events.some((e) => e.type === 'monetary-policy-changed')).toBe(true);
  });

  it('raises interestRate in a boom (commodity-basket above baseline, day 30)', () => {
    const state = stateWithRegions();
    const boom: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 120 }, // +20% → boom
        },
      },
    };
    const before = boom.eventState.global.monetaryPolicy.interestRate;
    const result = updateMonetaryPolicy(boom, PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS * DAY);
    expect(result.state.eventState.global.monetaryPolicy.interestRate).toBeGreaterThan(before);
  });

  it('holds policy when the market is near baseline (no event emitted)', () => {
    const state = stateWithRegions();
    const stable: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 100 },
        },
      },
    };
    const result = updateMonetaryPolicy(stable, PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS * DAY);
    expect(result.state).toBe(stable);
    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Action handlers (6 actions)
// ---------------------------------------------------------------------------

describe('actions — schedule-event', () => {
  it('queues a scheduled event + emits event-scheduled', () => {
    const state = freshState();
    const result = engine.executeAction(state, {
      type: 'schedule-event',
      payload: {
        eventTypeId: 'event:drought',
        scheduledAt: 120,
        payload: {},
        priority: 'normal',
        tick: 0,
      },
    });
    expect(result.state.eventState.scheduler.scheduled).toHaveLength(1);
    expect(result.events.some((e) => e.type === 'event-scheduled')).toBe(true);
  });

  it('rejects an unknown event type id (UnknownEventDefinitionError)', () => {
    const state = freshState();
    expect(() =>
      engine.executeAction(state, {
        type: 'schedule-event',
        payload: { eventTypeId: 'event:nope', scheduledAt: 0, payload: {}, priority: 'normal', tick: 0 },
      }),
    ).toThrow(UnknownEventDefinitionError);
  });
});

describe('actions — cancel-event', () => {
  it('removes a scheduled event by id (idempotent on a missing id)', () => {
    const state = freshState();
    const scheduled = engine.executeAction(state, {
      type: 'schedule-event',
      payload: { eventTypeId: 'event:drought', scheduledAt: 120, payload: {}, priority: 'normal', tick: 0 },
    }).state;
    const cancelled = engine.executeAction(scheduled, {
      type: 'cancel-event',
      payload: { eventId: 'evt-0', tick: 0 },
    }).state;
    expect(cancelled.eventState.scheduler.scheduled).toHaveLength(0);
    // Idempotent on a missing id — no throw.
    expect(() =>
      engine.executeAction(cancelled, {
        type: 'cancel-event',
        payload: { eventId: 'evt-missing', tick: 0 },
      }),
    ).not.toThrow();
  });
});

describe('actions — trigger-event', () => {
  it('immediately fires an event (bypasses the queue) + emits event-triggered', () => {
    const state = stateWithRegions();
    const result = engine.executeAction(state, {
      type: 'trigger-event',
      payload: {
        eventTypeId: 'event:drought',
        regionId: 'region:arid-highlands',
        severity: 'severe',
        payload: {},
        tick: 0,
      },
    });
    expect(result.state.eventState.scheduler.active).toHaveLength(1);
    expect(result.state.eventState.scheduler.active[0]!.severity).toBe('severe');
    expect(result.events.some((e) => e.type === 'event-triggered')).toBe(true);
  });
});

describe('actions — resolve-event', () => {
  it('resolves an active event early (outcome mitigated) + emits event-resolved', () => {
    const state = stateWithRegions();
    const triggered = engine.executeAction(state, {
      type: 'trigger-event',
      payload: { eventTypeId: 'event:drought', payload: {}, tick: 0 },
    }).state;
    const activeId = triggered.eventState.scheduler.active[0]!.id;
    const result = engine.executeAction(triggered, {
      type: 'resolve-event',
      payload: { eventId: activeId, tick: 0 },
    });
    expect(result.state.eventState.scheduler.active).toHaveLength(0);
    expect(result.state.eventState.scheduler.history).toHaveLength(1);
    expect(result.state.eventState.scheduler.history[0]!.outcome).toBe('mitigated');
    expect(result.events.some((e) => e.type === 'event-resolved')).toBe(true);
  });

  it('rejects an unknown active id (UnknownActiveEventError)', () => {
    const state = stateWithRegions();
    expect(() =>
      engine.executeAction(state, {
        type: 'resolve-event',
        payload: { eventId: 'evt-missing', tick: 0 },
      }),
    ).toThrow(UnknownActiveEventError);
  });
});

describe('actions — set-government-policy', () => {
  it('merges a partial policy into governmentPolicy + emits government-policy-changed', () => {
    const state = freshState();
    const result = engine.executeAction(state, {
      type: 'set-government-policy',
      payload: { policy: { carbonTaxRate: 0.15 }, tick: 1000 },
    });
    expect(result.state.eventState.global.governmentPolicy.carbonTaxRate).toBe(0.15);
    // Untouched fields preserved.
    expect(result.state.eventState.global.governmentPolicy.environmentalRegulations).toBe(
      state.eventState.global.governmentPolicy.environmentalRegulations,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('government-policy-changed');
    expect(result.events[0]!.payload.policy.carbonTaxRate).toBe(0.15);
  });

  it('replaces subsidies wholesale when supplied', () => {
    const state = freshState();
    const result = engine.executeAction(state, {
      type: 'set-government-policy',
      payload: {
        policy: { subsidies: [{ type: 'subsidy:renewable-energy', rate: 0.25 }] },
        tick: 0,
      },
    });
    expect(result.state.eventState.global.governmentPolicy.subsidies).toEqual([
      { type: 'subsidy:renewable-energy', rate: 0.25 },
    ]);
  });
});

describe('actions — set-monetary-policy', () => {
  it('merges a partial policy into monetaryPolicy + emits monetary-policy-changed', () => {
    const state = freshState();
    const result = engine.executeAction(state, {
      type: 'set-monetary-policy',
      payload: { policy: { interestRate: 0.08 }, tick: 2000 },
    });
    expect(result.state.eventState.global.monetaryPolicy.interestRate).toBe(0.08);
    expect(result.state.eventState.global.monetaryPolicy.inflationTarget).toBe(
      state.eventState.global.monetaryPolicy.inflationTarget,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('monetary-policy-changed');
  });
});

// ---------------------------------------------------------------------------
// Determinism + purity
// ---------------------------------------------------------------------------

describe('determinism + purity', () => {
  it('same seed → same event sequence (scheduleEvent + processScheduledEvents)', () => {
    const a = freshState(7);
    const b = freshState(7);
    let sa = scheduleEvent(a, 'event:drought', 0, {}, 'normal', 0).state;
    let sb = scheduleEvent(b, 'event:drought', 0, {}, 'normal', 0).state;
    sa = processScheduledEvents(sa, 0).state;
    sb = processScheduledEvents(sb, 0).state;
    expect(sa.eventState.scheduler).toEqual(sb.eventState.scheduler);
  });

  it('same seed → same engine.advance event-sequence prefix (EventSystem contributes deterministically)', () => {
    const a = freshState(11);
    const b = freshState(11);
    const ra = engine.advance(a, STEP);
    const rb = engine.advance(b, STEP);
    // The EventSystem is deterministic (no RNG fork — R-P10-N) so two
    // advances from the same seed produce identical state + events.
    expect(ra.state.eventState).toEqual(rb.state.eventState);
    expect(ra.events).toEqual(rb.events);
  });

  it('EventSystem.execute does not mutate the input state (freeze test)', () => {
    const state = deepFreeze(structuredClone(freshState(42)));
    const ctx = ctxAt(state, state.clock.elapsedSeconds + STEP);
    const result = eventSystem.execute(state, ctx);
    // Ran without throwing on the frozen input → no mutation. The returned
    // state has seeded regions (first tick).
    expect(result.state.eventState.global.regions.length).toBeGreaterThan(0);
    // The frozen input still has empty regions.
    expect(state.eventState.global.regions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RNG fork DEFERRED (R-P10-N — matches the R-P7-1 / R-P8-1 / R-P9-1 precedent)
// ---------------------------------------------------------------------------

describe('EventSystem — RNG fork deferred (R-P10-N: zero root draws)', () => {
  it('execute() consumes ZERO root RNG draws (rng state unchanged)', () => {
    const initial = freshState(42);
    const rng = Rng.fromState(initial.rngState);
    const before = rng.getState();
    const c: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    eventSystem.execute(initial, c);
    // The EventSystem drew nothing (no fork). If a future change adds
    // ctx.rng.fork('EventSystem'), fork() advances the root by one draw
    // (rng.ts) and this assertion fails.
    expect(rng.getState()).toEqual(before);
  });

  it('execute() consumes ZERO root RNG draws even on a check tick (first tick seeds regions + aggregates)', () => {
    const initial = freshState(42);
    const rng = Rng.fromState(initial.rngState);
    const before = rng.getState();
    const c: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    const result = eventSystem.execute(initial, c);
    // First tick seeds regions + aggregates + evolves — all deterministic.
    expect(result.state.eventState.global.regions.length).toBeGreaterThan(0);
    expect(rng.getState()).toEqual(before);
  });

  it('a full engine.advance persists the SAME root RNG whether or not the EventSystem runs', () => {
    const initial = freshState(42);
    const full = engine.advance(initial, STEP);
    // Manually replay one step WITHOUT the EventSystem to isolate its
    // root-RNG contribution (mirrors runOneStep's RNG threading).
    const rng = Rng.fromState(initial.rngState);
    const c: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    let next: GameState = initial;
    for (const system of defaultRegistry.all()) {
      if (system.id === 'EventSystem') continue;
      next = system.execute(next, c).state;
    }
    // The persisted root RNG position is IDENTICAL whether or not the
    // EventSystem ran — it contributes zero root draws, so the downstream
    // BiologySystem + AutomationSystem RNG sequences are unaffected (R-P10-N).
    expect(rng.getState()).toEqual(full.state.rngState);
  });

  it('EventSystem does NOT perturb the BiologySystem mortality sequence (starved tree still dies with the EventSystem present)', () => {
    // The crippled-tree "starved tree still dies" test (environment.test.ts:984)
    // is calibrated to the CURRENT root-RNG sequence. Adding an EventSystem
    // fork would shift BiologySystem's mortality rolls (the persisted rngState
    // accumulates every per-step fork, so BiologySystem's child seed at step
    // N+1 depends on step N's fork count) and flip dies-in-1-day → survives.
    // This test pins the no-fork outcome: a crippled tree still dies within
    // one sim day with the EventSystem in the registry — proving the
    // mortality sequence is unperturbed.
    function crippled(seed: number): GameState {
      const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
      const t = s.originalTree;
      return {
        ...s,
        originalTree: {
          ...t,
          alive: true,
          stress: 1,
          health: 0,
          energy: { ...t.energy, reserves: 0, production: 0, consumption: 0 },
          water: { ...t.water, stored: 0 },
          foliage: { ...t.foliage, currentLeaves: 0 },
          damage: [
            { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
            { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
          ],
        },
      };
    }
    const state = crippled(3);
    // Advance one sim day (enough for the BiologySystem mortality check to
    // kill the starved tree — calibrated to the current 2-fork-per-step
    // root sequence).
    const result = engine.advance(state, DAY);
    expect(result.state.originalTree.alive).toBe(false);
  });
});
