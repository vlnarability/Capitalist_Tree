/**
 * `perform-labor` action tests (P12-D follow-up — a second income path that
 * costs the player's health).
 *
 * Covers: wage crediting (issuance semantics), exhaustion accrual, event
 * emission, the graceful-rejection guards (too unhealthy / too exhausted),
 * the well-being derivation turning exhaustion into a health penalty, rest
 * recovery over ticks, determinism, and that labor does NOT touch the tree
 * (distinct from harvesting leaves).
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { getBalance } from '../src/economy/ledger.js';
import {
  type GameState,
  type GameConfig,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR,
  PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR,
  PROVISIONAL_LABOR_EXHAUSTION_MAX,
  PROVISIONAL_LABOR_HEALTH_PENALTY_MAX,
  PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK,
  PROVISIONAL_LABOR_EXHAUSTION_RECOVERY_PER_TICK,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

/** Build a fresh initialized state. */
function baseState(seed = 7): GameState {
  return engine.initialize(cfg(seed));
}

const WAGE_PER_HOUR = BigInt(PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR);

describe('perform-labor action', () => {
  it('credits wage cash, accrues exhaustion, and emits transaction-recorded + labor-completed', () => {
    const s = baseState();
    const cashBefore = BigInt(s.player.personalCash);
    const hours = 8;
    const expectedWage = BigInt(hours) * WAGE_PER_HOUR; // 8 × 500 = 4000

    const r = engine.executeAction(s, {
      type: 'perform-labor',
      payload: { hours },
    });

    // Cash rose by exactly the wage.
    expect(BigInt(r.state.player.personalCash)).toBe(cashBefore + expectedWage);

    // The ledger balance mirrors personalCash.
    expect(getBalance(r.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID).toString(10)).toBe(
      r.state.player.personalCash,
    );

    // Exhaustion accrued: hours × PER_HOUR = 8 × 0.05 = 0.4.
    expect(r.state.player.laborExhaustion).toBeCloseTo(hours * PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR, 10);

    // Both events emitted, in order.
    expect(r.events.map((e) => e.type)).toEqual([
      'transaction-recorded',
      'labor-completed',
    ]);

    const laborEvent = r.events.find((e) => e.type === 'labor-completed');
    expect(laborEvent).toBeDefined();
    if (laborEvent?.type === 'labor-completed') {
      expect(laborEvent.payload.hours).toBe(hours);
      expect(laborEvent.payload.amountMinor).toBe(expectedWage.toString(10));
      expect(laborEvent.payload.exhaustionBefore).toBe(0);
      expect(laborEvent.payload.exhaustionAfter).toBeCloseTo(0.4, 10);
      // healthCost = (after - before) × MAX = 0.4 × 0.5 = 0.2.
      expect(laborEvent.payload.healthCost).toBeCloseTo(0.4 * PROVISIONAL_LABOR_HEALTH_PENALTY_MAX, 10);
      expect(laborEvent.payload.playerBalanceAfter).toBe(r.state.player.personalCash);
    }

    // The transaction-recorded event carries a 'labor' category transaction.
    const txEvent = r.events.find((e) => e.type === 'transaction-recorded');
    expect(txEvent).toBeDefined();
    if (txEvent?.type === 'transaction-recorded') {
      expect(txEvent.payload.record.category).toBe('labor');
      expect(txEvent.payload.record.amount).toBe(expectedWage.toString(10));
    }
  });

  it('labor is issuance — monetarySupply + totalIssued rise by the wage', () => {
    const s = baseState();
    const supplyBefore = BigInt(s.economy.monetarySupply);
    const issuedBefore = BigInt(s.economy.totalIssued);
    const hours = 4;
    const expectedWage = BigInt(hours) * WAGE_PER_HOUR;

    const r = engine.executeAction(s, {
      type: 'perform-labor',
      payload: { hours },
    });

    expect(BigInt(r.state.economy.monetarySupply)).toBe(supplyBefore + expectedWage);
    expect(BigInt(r.state.economy.totalIssued)).toBe(issuedBefore + expectedWage);
    // totalSinks unchanged (labor is issuance, not a sink).
    expect(BigInt(r.state.economy.totalSinks)).toBe(BigInt(s.economy.totalSinks));
  });

  it('does NOT touch the tree — no pendingIssuances, no stress, no defoliation damage', () => {
    const s = baseState();
    const treeBefore = s.originalTree;

    const r = engine.executeAction(s, {
      type: 'perform-labor',
      payload: { hours: 8 },
    });

    const treeAfter = r.state.originalTree;
    // No currency-issuance request queued (labor credits cash directly, unlike
    // harvest-leaves which queues onto pendingIssuances).
    expect(treeAfter.pendingIssuances).toEqual(treeBefore.pendingIssuances);
    expect(treeAfter.pendingIssuances).toHaveLength(0);
    // No stress added, no defoliation damage recorded.
    expect(treeAfter.stress).toBe(treeBefore.stress);
    expect(treeAfter.damage).toEqual(treeBefore.damage);
    expect(treeAfter.foliage.currentLeaves).toBe(treeBefore.foliage.currentLeaves);
  });

  it('guard: rejects when the shift would push exhaustion past the cap (no cash, no exhaustion gain)', () => {
    // Start the player near the cap, then attempt a shift that would exceed it.
    const s: GameState = {
      ...baseState(),
      player: { ...baseState().player, laborExhaustion: 0.95 },
    };
    const cashBefore = BigInt(s.player.personalCash);

    // 2h → gain 0.10 → 0.95 + 0.10 = 1.05 > 1.0 → rejected.
    const r = engine.executeAction(s, {
      type: 'perform-labor',
      payload: { hours: 2 },
    });

    // No cash moved, no exhaustion gained.
    expect(BigInt(r.state.player.personalCash)).toBe(cashBefore);
    expect(r.state.player.laborExhaustion).toBeCloseTo(0.95, 10);
    // No labor-completed event; a warning notification instead.
    expect(r.events.map((e) => e.type)).not.toContain('labor-completed');
    expect(r.events.map((e) => e.type)).not.toContain('transaction-recorded');
    const note = r.events.find((e) => e.type === 'notification');
    expect(note).toBeDefined();
    expect(note?.type === 'notification' && note.payload.code).toBe('too-exhausted-to-labor');
  });

  it('guard: a shift that lands exactly at the cap is allowed (boundary)', () => {
    // 0.95 + 1h × 0.05 = 1.00 — NOT strictly greater than the cap → allowed.
    const s: GameState = {
      ...baseState(),
      player: { ...baseState().player, laborExhaustion: 0.95 },
    };

    const r = engine.executeAction(s, {
      type: 'perform-labor',
      payload: { hours: 1 },
    });

    expect(r.events.map((e) => e.type)).toContain('labor-completed');
    expect(r.state.player.laborExhaustion).toBeCloseTo(1.0, 10);
  });

  it('guard: rejects when the player is too unhealthy to work', () => {
    const minHealth = PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK; // 0.15
    const s: GameState = {
      ...baseState(),
      player: { ...baseState().player, health: minHealth - 0.05 }, // 0.10 < 0.15
    };
    const cashBefore = BigInt(s.player.personalCash);

    const r = engine.executeAction(s, {
      type: 'perform-labor',
      payload: { hours: 1 },
    });

    expect(BigInt(r.state.player.personalCash)).toBe(cashBefore);
    expect(r.events.map((e) => e.type)).not.toContain('labor-completed');
    const note = r.events.find((e) => e.type === 'notification');
    expect(note?.type === 'notification' && note.payload.code).toBe('too-unhealthy-to-labor');
  });

  it('health drops after one tick via the well-being derivation; exhaustion decays', () => {
    // Fresh state: health = 1, exhaustion = 0.
    const s = baseState();
    expect(s.player.health).toBe(1);
    expect(s.player.laborExhaustion).toBe(0);

    // Work 8h → exhaustion 0.4. Health is NOT updated by the action (the
    // PersonalSystem re-derives it next tick).
    const afterLabor = engine.executeAction(s, {
      type: 'perform-labor',
      payload: { hours: 8 },
    });
    expect(afterLabor.state.player.health).toBe(1); // still the pre-labor value
    expect(afterLabor.state.player.laborExhaustion).toBeCloseTo(0.4, 10);

    // Advance one tick. PersonalSystem decays exhaustion (0.4 × 0.9 = 0.36)
    // THEN derives health = 1 - 0.36 × 0.5 = 0.82.
    const tick1 = engine.advance(afterLabor.state, STEP);
    const expectedExhaustion = 0.4 * (1 - PROVISIONAL_LABOR_EXHAUSTION_RECOVERY_PER_TICK);
    expect(tick1.state.player.laborExhaustion).toBeCloseTo(expectedExhaustion, 6);
    const expectedHealth = 1 - expectedExhaustion * PROVISIONAL_LABOR_HEALTH_PENALTY_MAX;
    expect(tick1.state.player.health).toBeCloseTo(expectedHealth, 6);
    // Health actually dropped below 1.
    expect(tick1.state.player.health).toBeLessThan(1);
  });

  it('exhaustion + health recover over several ticks (rest)', () => {
    const s: GameState = {
      ...baseState(),
      player: { ...baseState().player, laborExhaustion: 0.8 },
    };

    // Advance several ticks — exhaustion decays asymptotically toward 0.
    let state = s;
    for (let i = 0; i < 30; i++) {
      state = engine.advance(state, STEP).state;
    }
    // Exhaustion should be near 0 (0.8 × 0.9^30 ≈ 0.035).
    expect(state.player.laborExhaustion).toBeLessThan(0.05);
    // Health recovered toward 1 (no unpaid bills on these early ticks).
    expect(state.player.health).toBeGreaterThan(0.95);
  });

  it('deterministic: same state + action → same result', () => {
    const s = baseState();
    const action = { type: 'perform-labor' as const, payload: { hours: 6 } };

    const r1 = engine.executeAction(s, action);
    const r2 = engine.executeAction(s, action);

    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
  });

  it('exhaustion never exceeds the cap across many shifts, and blocks once saturated', () => {
    let s = baseState();
    let applied = 0;
    let blocked = 0;
    for (let i = 0; i < 30; i++) {
      const r = engine.executeAction(s, {
        type: 'perform-labor',
        payload: { hours: 1 },
      });
      // The cap invariant always holds, whether the shift applied or was blocked.
      expect(r.state.player.laborExhaustion).toBeLessThanOrEqual(
        PROVISIONAL_LABOR_EXHAUSTION_MAX,
      );
      if (r.events.some((e) => e.type === 'labor-completed')) {
        applied++;
      } else {
        blocked++;
      }
      s = r.state;
    }
    // Some shifts applied (income earned) + some were blocked once exhaustion
    // saturated near the cap.
    expect(applied).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
    // Final exhaustion saturated near the cap (within one shift's gain).
    expect(s.player.laborExhaustion).toBeGreaterThanOrEqual(
      PROVISIONAL_LABOR_EXHAUSTION_MAX - PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR - 1e-9,
    );
  });
});
