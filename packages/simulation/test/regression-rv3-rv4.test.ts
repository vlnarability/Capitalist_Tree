/**
 * RV3-2 + RV4-F-H2 regression tests (P11 / DR-9).
 *
 * Two HIGH-severity findings were fixed in P11; DR-9 (docs/reviews/DECISIONS.md)
 * directs adding regression tests that would catch them if they regress. This
 * file asserts the invariants the fixes established:
 *
 *   - RV3-2 (W1): the `operate-business` handler IGNORES any player-supplied
 *     `payload.tick` and uses `state.clock.elapsedSeconds` as the authoritative
 *     `now` (packages/simulation/src/business/actions.ts:339-368). Pre-fix, the
 *     handler destructured `tick` from `action.payload` and passed it as
 *     `now: tick` to `operateBusiness`. A player dispatched a forward-dated
 *     `operate-business` (payload.tick = a future sim-second) then
 *     `advance(STEP)`. The BusinessSystem (per-tick driver) ALSO ran production
 *     at `now = state.clock.elapsedSeconds + STEP`. If payload.tick matched
 *     that future `now`, the action AND the system ran at the SAME `now` →
 *     demand-injection replayed → money created from nothing (conservation
 *     violated). The regression tests below reproduce the exploit path and
 *     assert conservation of money holds across the FULL transaction path
 *     (transfers, costs, account consolidation).
 *
 *   - RV4-F-H2 (W3): every EnvironmentSystem step function scales its rates by
 *     `dtSeconds = ctx.stepSeconds` (packages/simulation/src/systems/
 *     environment.ts:301). Pre-fix, `events.ts` called
 *     `applyEnvironmentalFeedback(next)` with NO `dtSeconds`; rates were
 *     unscaled — a rate expressed per-day was applied once per tick
 *     regardless of tick size, so more ticks = more total change for the same
 *     elapsed time. The regression tests below run the SAME total elapsed
 *     sim-time via different tick sizes and assert materially equivalent
 *     environment outcomes.
 *
 * Complements (referenced, not duplicated):
 *   - `economy-invariants.test.ts` — the conservation invariant across ALL
 *     money-movement operations (TDD §10.4). The RV3-2 tests below reuse
 *     `conservationDiscrepancy(state, initialSupply)` from that file's
 *     economy helpers rather than re-deriving the identity.
 *   - `business.test.ts` "actions — operate-business" — the unit test
 *     "ignores a player-supplied forward-dated tick (RV3-2 exploit closed)"
 *     is the seed for the RV3-2 coverage here; this file broadens it to the
 *     full transaction path per DR-9 (transfers, costs, account
 *     consolidation, repeated dispatches, event-timestamp provenance).
 *   - `environment.test.ts` — the EnvironmentSystem unit tests
 *     (R-P7-1 RNG determinism). This file adds the dt-scaling invariant.
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  environmentSystem,
  type SystemContext,
  Rng,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { conservationDiscrepancy, parseAmount } from '../src/economy/index.js';
import { WATER_EXTRACTION_PLANT } from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type SimulationEvent,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Helpers (mirror economy-invariants.test.ts + business.test.ts patterns).
// ---------------------------------------------------------------------------

const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash; // '50000'

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function freshState(): GameState {
  return engine.initialize(cfg(42));
}

/**
 * Purchase a WATER_EXTRACTION_PLANT business on `state` and return the
 * post-purchase state + the new business id. The plant's content definition
 * lists `operate-business` in `supportedActions` (the content gate the
 * handler checks via `requireSupportedAction`), so a subsequently-dispatched
 * `operate-business` runs a real production cycle rather than throwing.
 *
 * Mirrors the fixture pattern in business.test.ts:713-737 (purchase deducts
 * the player's cash, registers the business account at balance 0, appends the
 * BusinessState to `state.businesses`, emits `business-purchased`).
 */
function withOperatingBusiness(state: GameState): {
  state: GameState;
  businessId: string;
} {
  const result = engine.executeAction(state, {
    type: 'purchase-business',
    payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
  });
  const business = result.state.businesses[result.state.businesses.length - 1];
  if (!business) {
    throw new Error('fixture: purchase-business did not append a business');
  }
  return { state: result.state, businessId: business.id };
}

/** Find the (first) `business-operated` event in a list. */
function operatedEvent(
  events: readonly SimulationEvent[],
): SimulationEvent | undefined {
  return events.find((e) => e.type === 'business-operated');
}

/**
 * Run ONLY the EnvironmentSystem `steps` times with the given `stepSeconds`,
 * starting from `initial`. Mirrors `runOneStep`'s RNG threading
 * (packages/simulation/src/simulation.ts:117-172) but invokes just the
 * EnvironmentSystem (registry slot #10) so we can vary `ctx.stepSeconds`.
 *
 * NOTE (DR-9 / W3): the public `engine.advance(state, elapsedSeconds)`
 * HARDCODES 60s steps — `simulation.ts:183-189` computes
 * `Math.floor(elapsedSeconds / STEP)` whole steps of `STEP` (=60s) and calls
 * `runOneStep(next, STEP)` for each. There is no public API to advance the
 * engine with a different per-step size. To exercise the RV4-F-H2 fix (which
 * lives in the EnvironmentSystem's `ctx.stepSeconds` consumption), we invoke
 * `environmentSystem.execute(state, ctx)` directly with a hand-built
 * `SystemContext` whose `stepSeconds` we control. This is the closest faithful
 * reproduction of "different tick sizes for the same elapsed time" available
 * against the existing public + system API surface; it does not invent a new
 * API.
 *
 * The EnvironmentSystem is documented as zero root-RNG draws (R-P7-1: fork
 * deferred — see environment.test.ts:963-985), so the run is fully
 * deterministic given (initial, stepSeconds, steps). Inputs the
 * EnvironmentSystem reads but does not own (`world.weather`, `originalTree`
 * biology outputs that drive `deriveForestCoverage`) stay at their initial
 * values across steps — no other system runs to advance them — so both
 * compared runs see the SAME constant inputs, isolating the dt-scaling
 * comparison to the EnvironmentSystem's own rate-based transforms.
 */
function runEnvironmentSteps(
  initial: GameState,
  stepSeconds: number,
  steps: number,
): GameState {
  let state = initial;
  let now = initial.clock.elapsedSeconds;
  for (let i = 0; i < steps; i++) {
    now += stepSeconds;
    // Rebuild the rng from the persisted state each step (mirrors runOneStep's
    // `Rng.fromState(state.rngState)` at simulation.ts:119). The
    // EnvironmentSystem draws nothing, so `state.rngState` is unchanged across
    // steps — this rebuild is purely defensive + faithful to the engine's
    // threading.
    const rng = Rng.fromState(state.rngState);
    const ctx: SystemContext = {
      now,
      stepSeconds,
      dayOfYear: state.clock.day,
      rng,
    };
    const result = environmentSystem.execute(state, ctx);
    state = result.state;
  }
  return state;
}

/**
 * Assert the RV4-F-H2 rate-scaling invariant for one numeric environment
 * field: running `totalSeconds` of sim time as MANY SMALL steps must produce
 * the same outcome as running it as FEW LARGE steps.
 *
 * Post-fix (rates scaled by `dtSeconds`): both runs apply
 * `rate × totalSeconds` → identical results (within float rounding + a tiny
 * per-step nonlinearity from equilibrium feedback, e.g. `stepTemperature`
 * relaxing toward a `now`-shifted equilibrium each step).
 *
 * Pre-fix (rates unscaled, applied once per tick): the many-small-steps run
 * applied `rate × N_small` vs the few-large-steps run's `rate × N_large` → a
 * divergence of `(N_small / N_large − 1) × drift`. For 30 steps of 60s vs
 * 5 steps of 360s (same 1800s), N_small / N_large = 6 → 500% of the
 * large-step drift.
 *
 * Tolerance: `max(1e-6, 5% × max(driftSmall, driftLarge))`.
 *   - The `1e-6` floor handles fields that don't visibly move over 1800s
 *     (rate ≈ 0 → both runs unchanged → trivially equal). Without the floor,
 *     a zero-drift field would make the relative band collapse to 0 and the
 *     test would fail on pure float noise.
 *   - The 5% relative band handles float rounding + the tiny nonlinearity
 *     from per-step equilibrium shifts (for rates calibrated per-day or
 *     per-year and dt ≤ 360s, the per-step nonlinearity is ~`(k·dt)²/2` —
 *     negligible, well under 5%). A 6× pre-fix divergence (500% of drift)
 *     blows this band by two orders of magnitude, so the test catches the
 *     regression on any field with a non-zero rate.
 */
function expectRateScaleInvariant(
  field: string,
  initial: number,
  valueManySmallSteps: number,
  valueFewLargeSteps: number,
): void {
  const driftSmall = Math.abs(valueManySmallSteps - initial);
  const driftLarge = Math.abs(valueFewLargeSteps - initial);
  const divergence = Math.abs(valueManySmallSteps - valueFewLargeSteps);
  const tolerance = Math.max(1e-6, 0.05 * Math.max(driftSmall, driftLarge));
  // Vitest prints actual/expected on failure; the field name in the assertion
  // message pins WHICH field diverged when comparing several in one test.
  expect(divergence, `${field}: divergence ${divergence} >= tolerance ${tolerance} (manySmall=${valueManySmallSteps}, fewLarge=${valueFewLargeSteps}, initial=${initial})`).toBeLessThan(tolerance);
}

// ============================================================================
// RV3-2 — operate-business cannot create money via tick injection (W1 / DR-9).
//
// Exploit recap (pre-fix): `operateBusinessHandler` destructured `tick` from
// `action.payload` and passed it as `now: tick` to `operateBusiness`. A player
// dispatched `operate-business` with `payload.tick` = a future sim-second,
// then `advance(STEP)`. The BusinessSystem (per-tick driver) ALSO ran
// production at `now = state.clock.elapsedSeconds + STEP`. If `payload.tick`
// matched that future `now`, both the action AND the system ran at the SAME
// `now` → demand-injection replayed → money created from nothing (conservation
// violated).
//
// Fix (W1, actions.ts:339-368): the handler IGNORES `payload.tick` and uses
// `state.clock.elapsedSeconds` as `now`. The engine clock is the only source
// of truth for "when" an action runs. The tests below reproduce the exploit
// path and assert the invariant the fix established, across the full
// transaction path (transfers, costs, account consolidation).
// ============================================================================

describe('RV3-2 regression — operate-business cannot create money via tick injection (W1 / DR-9)', () => {
  it('conservation holds after one operate-business + one advance (no money created from nothing)', () => {
    // Baseline: a fresh state with one operating business. Dispatch
    // `operate-business` (one production cycle at the engine's now=0), then
    // advance one STEP (the BusinessSystem runs once at now=STEP). The action
    // and the system run at DIFFERENT `now`s → no collision → no duplicate
    // demand-injection → conservation holds.
    const s0 = freshState();
    expect(s0.clock.elapsedSeconds).toBe(0); // sanity: fresh state is at now=0
    const { state: withBiz, businessId } = withOperatingBusiness(s0);
    const baselineIssued = parseAmount(withBiz.economy.totalIssued, 'issued');
    const baselineSupply = parseAmount(withBiz.economy.monetarySupply, 'supply');
    const baselineSinks = parseAmount(withBiz.economy.totalSinks, 'sinks');

    // No `tick` field — schema accepts it (optional), handler uses engine clock.
    const afterOp = engine.executeAction(withBiz, {
      type: 'operate-business',
      payload: { businessId },
    });
    expect(conservationDiscrepancy(afterOp.state, INITIAL_SUPPLY)).toBe(0n);

    // Advance one STEP — the BusinessSystem runs production for this business
    // at now=STEP. The action ran at now=0; no collision.
    const afterAdvance = engine.advance(afterOp.state, STEP);
    // The core invariant: no money created from nothing.
    expect(conservationDiscrepancy(afterAdvance.state, INITIAL_SUPPLY)).toBe(0n);

    // Full transaction path: every real account balance is non-negative (no
    // silent overdraft masked by a duplicate booking).
    for (const acc of afterAdvance.state.economy.accounts) {
      expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
    }

    // Account consolidation sanity: the derived relationship
    // ΔmonetarySupply === ΔtotalIssued − ΔtotalSinks (the conservation
    // identity rearranged). Verifies the cached monetarySupply field agrees
    // with the actual balance sum + the issuance/sink counters — i.e. the
    // transfers + costs the operate-business path booked reconciled exactly.
    const finalIssued = parseAmount(afterAdvance.state.economy.totalIssued, 'issued');
    const finalSupply = parseAmount(afterAdvance.state.economy.monetarySupply, 'supply');
    const finalSinks = parseAmount(afterAdvance.state.economy.totalSinks, 'sinks');
    const issuedDelta = finalIssued - baselineIssued;
    const sinksDelta = finalSinks - baselineSinks;
    expect(finalSupply - baselineSupply).toBe(issuedDelta - sinksDelta);
  });

  it('ignores a player-supplied forward-dated payload.tick — the handler uses state.clock.elapsedSeconds as now', () => {
    // The W1 fix's mechanism: `payload.tick` is IGNORED. Prove it by passing a
    // wildly forward-dated tick and asserting the emitted `business-operated`
    // event's `at` === `state.clock.elapsedSeconds` (NOT `payload.tick`). The
    // event's `at` is set to `now` inside `operateBusiness` (production.ts:268,
    // 578), so it is a faithful witness of which `now` the handler actually
    // used.
    const s0 = freshState();
    const { state: withBiz, businessId } = withOperatingBusiness(s0);
    const futureTick = STEP * 1000; // a wildly forward-dated sim second
    const result = engine.executeAction(withBiz, {
      type: 'operate-business',
      // Send a forward-dated tick — the handler MUST ignore it.
      payload: { businessId, tick: futureTick },
    });
    const ev = operatedEvent(result.events);
    expect(ev).toBeDefined();
    // The event's `at` is the authoritative `now` the handler used. It must
    // equal the engine clock, NOT the player-supplied futureTick.
    expect(ev!.at).toBe(withBiz.clock.elapsedSeconds);
    expect(ev!.at).toBe(0);
    expect(ev!.at).not.toBe(futureTick);
    // Conservation holds (no money created by the ignored-tick dispatch).
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('the exploit path (forward-dated tick + advance) does not create money — full transaction path reconciles', () => {
    // Reproduce the pre-fix exploit ATTEMPT: dispatch `operate-business` with
    // a forward-dated tick whose value is exactly the `now` the BusinessSystem
    // will use on the next advance (STEP), then advance(STEP). Pre-fix, the
    // action ran at now=payload.tick=STEP and the system re-ran at now=STEP →
    // duplicate demand-injection → conservation violated. Post-fix, the action
    // runs at now=0 (engine clock) and the system runs at now=STEP → no
    // collision. Assert the full transaction path reconciles.
    const s0 = freshState();
    const { state: withBiz, businessId } = withOperatingBusiness(s0);
    const baselineIssued = parseAmount(withBiz.economy.totalIssued, 'issued');

    // Exploit attempt: forward-dated tick = STEP (the future now the system
    // will use on advance).
    const afterOp = engine.executeAction(withBiz, {
      type: 'operate-business',
      payload: { businessId, tick: STEP },
    });
    // The action ran at now=0 (engine clock), NOT now=STEP (payload.tick).
    const opEv = operatedEvent(afterOp.events);
    expect(opEv).toBeDefined();
    expect(opEv!.at).toBe(0);
    expect(opEv!.at).not.toBe(STEP);

    // Advance — the BusinessSystem runs at now=STEP. Pre-fix this would
    // re-book revenue at the SAME now=STEP the action used (because the
    // action used payload.tick=STEP) → duplicate. Post-fix, no collision.
    const afterAdvance = engine.advance(afterOp.state, STEP);
    // The core invariant: no money created from nothing.
    expect(conservationDiscrepancy(afterAdvance.state, INITIAL_SUPPLY)).toBe(0n);

    // Full transaction path: every real account balance is non-negative.
    for (const acc of afterAdvance.state.economy.accounts) {
      expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
    }
    // The advance produced AT MOST one `business-operated` event for this
    // business (the system's per-tick run). A duplicate would mean the action
    // + system both booked at the same `now` — the exploit signature.
    const advanceOps = afterAdvance.events.filter(
      (e) => e.type === 'business-operated' && e.payload?.businessId === businessId,
    );
    expect(advanceOps.length).toBeLessThanOrEqual(1);

    // No exploit-sized jump in totalIssued: a one-tick WATER_EXTRACTION_PLANT
    // cycle produces fractional output (< 1 unit → floored to 0 → no sale) and
    // wages floored to 0 (business.test.ts:765-772 pins this), so no
    // market-backstop issuance should have fired. totalIssued is unchanged
    // from the post-purchase baseline. (If the business type or tick count
    // changes such that legitimate issuance occurs, relax this to
    // `>= baselineIssued` — conservation above is the load-bearing assertion.)
    const finalIssued = parseAmount(afterAdvance.state.economy.totalIssued, 'issued');
    expect(finalIssued).toBe(baselineIssued);
  });

  it('repeated operate-business dispatches at the SAME engine clock never create money (no double-counting)', () => {
    // The invariant in its general form: dispatching `operate-business`
    // multiple times WITHOUT advancing the clock must not create money. Each
    // dispatch runs production at the SAME `now` (state.clock.elapsedSeconds);
    // the revenue / wages / input transfers use requestIds derived from
    // `(saveId, now, businessId, kind)` (production.ts:417, 431, 453), so the
    // 2nd+ dispatch's transfers collide on requestId → duplicate-request
    // rejection → no money moved. Conservation holds.
    //
    // The W1 fix's contribution: because the handler uses
    // `state.clock.elapsedSeconds` (not `payload.tick`) as `now`, a player
    // CANNOT escape the requestId collision by passing a different `tick` —
    // the second dispatch still runs at the same engine `now` as the first.
    // Pre-fix, a player could pass a different forward-dated `tick` on each
    // dispatch, giving each a DISTINCT requestId → each would issue money →
    // repeated dispatches = repeated issuance (the exploit's general form).
    const s0 = freshState();
    const { state: withBiz, businessId } = withOperatingBusiness(s0);
    const baselineIssued = parseAmount(withBiz.economy.totalIssued, 'issued');
    const baselineSupply = parseAmount(withBiz.economy.monetarySupply, 'supply');

    // Dispatch 1 (no tick field).
    const op1 = engine.executeAction(withBiz, {
      type: 'operate-business',
      payload: { businessId },
    });
    expect(conservationDiscrepancy(op1.state, INITIAL_SUPPLY)).toBe(0n);

    // Dispatch 2 at the SAME engine clock (executeAction does not advance the
    // clock — simulation.ts:198-202 returns `consumedSeconds: 0`). Pass a
    // forward-dated tick on this dispatch to prove it is IGNORED: the handler
    // still uses state.clock.elapsedSeconds (=== withBiz.clock.elapsedSeconds).
    const op2 = engine.executeAction(op1.state, {
      type: 'operate-business',
      payload: { businessId, tick: STEP * 9999 },
    });
    expect(conservationDiscrepancy(op2.state, INITIAL_SUPPLY)).toBe(0n);
    // The 2nd dispatch's event ran at the SAME `now` as the 1st (engine clock).
    const ev2 = operatedEvent(op2.events);
    expect(ev2).toBeDefined();
    expect(ev2!.at).toBe(withBiz.clock.elapsedSeconds);
    expect(ev2!.at).not.toBe(STEP * 9999);

    // Dispatch 3 — same again, different forward-dated tick.
    const op3 = engine.executeAction(op2.state, {
      type: 'operate-business',
      payload: { businessId, tick: STEP * 12345 },
    });
    expect(conservationDiscrepancy(op3.state, INITIAL_SUPPLY)).toBe(0n);

    // The 2nd + 3rd dispatches ran at the SAME `now` as the 1st → their
    // revenue/wages/input transfers collide on requestId → duplicate
    // rejection → no money moved. totalIssued + monetarySupply unchanged
    // across op1 → op2 → op3.
    expect(parseAmount(op2.state.economy.totalIssued, 'issued')).toBe(
      parseAmount(op1.state.economy.totalIssued, 'issued'),
    );
    expect(parseAmount(op3.state.economy.totalIssued, 'issued')).toBe(
      parseAmount(op1.state.economy.totalIssued, 'issued'),
    );
    expect(parseAmount(op2.state.economy.monetarySupply, 'supply')).toBe(
      parseAmount(op1.state.economy.monetarySupply, 'supply'),
    );
    // Final sanity: no money created relative to the post-purchase baseline.
    expect(parseAmount(op3.state.economy.totalIssued, 'issued')).toBe(baselineIssued);
    expect(parseAmount(op3.state.economy.monetarySupply, 'supply')).toBe(baselineSupply);
  });

  it('the exploit does not surface across a longer advance run with repeated forward-dated dispatches', () => {
    // Stress: interleave `operate-business` dispatches (each with a
    // forward-dated tick — the exploit pattern) with `advance(STEP)` over
    // several ticks. Conservation must hold at every step, and every
    // dispatched event's `at` must equal the engine clock (proving the
    // forward-dated tick is consistently ignored across the whole run).
    const s0 = freshState();
    const { state: withBiz, businessId } = withOperatingBusiness(s0);
    let s = withBiz;
    for (let i = 0; i < 5; i++) {
      // Dispatch with a forward-dated tick each tick (the exploit pattern).
      const afterOp = engine.executeAction(s, {
        type: 'operate-business',
        payload: { businessId, tick: STEP * (i + 100) },
      });
      expect(conservationDiscrepancy(afterOp.state, INITIAL_SUPPLY)).toBe(0n);
      // The event's `at` is the engine clock, NOT the forward-dated tick.
      const ev = operatedEvent(afterOp.events);
      expect(ev).toBeDefined();
      expect(ev!.at).toBe(s.clock.elapsedSeconds);
      expect(ev!.at).not.toBe(STEP * (i + 100));
      // Advance one STEP — the BusinessSystem runs at now = s.clock + STEP.
      const afterAdvance = engine.advance(afterOp.state, STEP);
      expect(conservationDiscrepancy(afterAdvance.state, INITIAL_SUPPLY)).toBe(0n);
      // Every real account stays non-negative across the whole run.
      for (const acc of afterAdvance.state.economy.accounts) {
        expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
      }
      s = afterAdvance.state;
    }
  });
});

// ============================================================================
// RV4-F-H2 — per-tick rates scale with dtSeconds (W3 / DR-9).
//
// Defect recap (pre-fix): `events.ts` called `applyEnvironmentalFeedback(next)`
// with NO `dtSeconds`; `climate.ts`'s `applyEnvironmentalFeedback` takes
// `dtSeconds`. Rates were unscaled — a rate expressed per-day was applied once
// per tick regardless of tick size, so more ticks = more total change for the
// same elapsed time. A rate-based mechanic produced materially different
// outcomes merely because the simulation processed more ticks.
//
// Fix (W3, environment.ts:301): `const dtSeconds = ctx.stepSeconds`, and every
// step function (`stepAtmosphere`, `stepTemperature`, `stepSoil`,
// `stepBiodiversity`, ...) takes `dtSeconds` and scales rates by it. The tests
// below run the SAME total elapsed sim-time via different tick sizes and
// assert materially equivalent environment outcomes.
// ============================================================================

describe('RV4-F-H2 regression — per-tick rates scale with dtSeconds (W3 / DR-9)', () => {
  it('30 steps of 60s ≈ 5 steps of 360s for the same 1800s elapsed (rate-based fields scale with dtSeconds)', () => {
    // The core RV4-F-H2 invariant: a rate-based mechanic must NOT produce
    // materially different outcomes just because the simulation took more /
    // smaller ticks. Run 1800s of sim time two ways from the SAME seed:
    //   - many small steps: 30 × 60s  (= 1800s)
    //   - few large steps:   5 × 360s (= 1800s)
    // Post-fix, both apply `rate × 1800s` → identical results. Pre-fix, the
    // 30-tick run applied `rate × 30` vs the 5-tick run's `rate × 5` → a 6×
    // divergence (500% of the large-step drift).
    const initial = freshState();
    const manySmall = runEnvironmentSteps(initial, 60, 30); // 1800s
    const fewLarge = runEnvironmentSteps(initial, 360, 5); // 1800s

    const init = initial.world.environment;
    const a = manySmall.world.environment;
    const b = fewLarge.world.environment;
    // Compare four rate-driven fields across atmosphere / temperature / soil /
    // biodiversity (the W3 fix touches every step function).
    expectRateScaleInvariant(
      'atmosphere.co2Concentration',
      init.atmosphere.co2Concentration,
      a.atmosphere.co2Concentration,
      b.atmosphere.co2Concentration,
    );
    expectRateScaleInvariant(
      'globalTemperature',
      init.globalTemperature,
      a.globalTemperature,
      b.globalTemperature,
    );
    expectRateScaleInvariant(
      'soil.health',
      init.soil.health,
      a.soil.health,
      b.soil.health,
    );
    expectRateScaleInvariant(
      'biodiversity.index',
      init.biodiversity.index,
      a.biodiversity.index,
      b.biodiversity.index,
    );
  });

  it('15 steps of 120s ≈ 30 steps of 60s (intermediate chunking produces the same outcome)', () => {
    // A second chunking of the same 1800s: 15 × 120s vs 30 × 60s. Post-fix
    // both apply `rate × 1800s`. Pre-fix, 15 ticks vs 30 ticks → 2× divergence
    // (100% of the 15-tick drift). Pins the invariant at a second step ratio
    // so a regression that only happened to pass at the 6:1 ratio is caught.
    const initial = freshState();
    const medium = runEnvironmentSteps(initial, 120, 15); // 1800s
    const small = runEnvironmentSteps(initial, 60, 30); // 1800s

    const init = initial.world.environment;
    const m = medium.world.environment;
    const s = small.world.environment;
    expectRateScaleInvariant(
      'atmosphere.co2Concentration',
      init.atmosphere.co2Concentration,
      m.atmosphere.co2Concentration,
      s.atmosphere.co2Concentration,
    );
    expectRateScaleInvariant(
      'globalTemperature',
      init.globalTemperature,
      m.globalTemperature,
      s.globalTemperature,
    );
    expectRateScaleInvariant(
      'soil.health',
      init.soil.health,
      m.soil.health,
      s.soil.health,
    );
    expectRateScaleInvariant(
      'biodiversity.index',
      init.biodiversity.index,
      m.biodiversity.index,
      s.biodiversity.index,
    );
  });

  it('1 step of 1800s ≈ 30 steps of 60s (extreme chunking — one large step vs many small)', () => {
    // Extreme chunking: a single 1800s step vs 30 × 60s steps. Post-fix both
    // apply `rate × 1800s`. Pre-fix, 1 tick vs 30 ticks → 30× divergence
    // (2900% of the 1-tick drift) — the most aggressive divergence a rate
    // regression could produce for this elapsed time. This is the strongest
    // signal a dt-scaling regression would trip.
    const initial = freshState();
    const oneBig = runEnvironmentSteps(initial, 1800, 1); // 1800s
    const manySmall = runEnvironmentSteps(initial, 60, 30); // 1800s

    const init = initial.world.environment;
    const o = oneBig.world.environment;
    const s = manySmall.world.environment;
    expectRateScaleInvariant(
      'atmosphere.co2Concentration',
      init.atmosphere.co2Concentration,
      o.atmosphere.co2Concentration,
      s.atmosphere.co2Concentration,
    );
    expectRateScaleInvariant(
      'globalTemperature',
      init.globalTemperature,
      o.globalTemperature,
      s.globalTemperature,
    );
    expectRateScaleInvariant(
      'soil.health',
      init.soil.health,
      o.soil.health,
      s.soil.health,
    );
    expectRateScaleInvariant(
      'biodiversity.index',
      init.biodiversity.index,
      o.biodiversity.index,
      s.biodiversity.index,
    );
  });
});
