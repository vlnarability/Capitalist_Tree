/**
 * GAP-28 Pack 1 (DR-3 cosmetic-only) — particle flourishes tests.
 *
 * Covers the pure event→burst mapping, the confetti transition gate, the spawn
 * (counts / shapes / reduced-motion gating), the per-frame update (alive/dead),
 * + that the component mounts its canvas overlay.
 *
 * Environment: happy-dom — the component render test needs a DOM (canvas +
 * useGameStore). The pure-function tests don't need a DOM but run fine here.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { SimulationEvent } from '@capitalist-tree/shared';
import {
  classifyEvent,
  shouldFireConfetti,
  spawnBurst,
  updateParticle,
  COIN_SHOWER_LEAF_THRESHOLD,
  CONFETTI_COUNT,
  COIN_COUNT,
  LEAF_COUNT,
  type Particle,
} from '../../../components/cosmetics/particle-bursts';
import { ParticleFlourishes } from '../../../components/cosmetics/ParticleFlourishes';
import { __resetGameStoreForTests } from '../../../stores/game-store';

beforeEach(() => {
  __resetGameStoreForTests();
});
afterEach(() => {
  __resetGameStoreForTests();
  cleanup();
});

describe('classifyEvent', () => {
  it('maps a small harvest to leaf-fall', () => {
    expect(classifyEvent(harvestEvent(COIN_SHOWER_LEAF_THRESHOLD - 1))).toBe('leaf-fall');
  });

  it('maps a harvest at the threshold to coin-shower', () => {
    expect(classifyEvent(harvestEvent(COIN_SHOWER_LEAF_THRESHOLD))).toBe('coin-shower');
  });

  it('maps a large harvest to coin-shower', () => {
    expect(classifyEvent(harvestEvent(COIN_SHOWER_LEAF_THRESHOLD + 50))).toBe('coin-shower');
  });

  it('returns null for non-harvest events', () => {
    expect(classifyEvent(otherEvent('tick'))).toBeNull();
    expect(classifyEvent(otherEvent('season-changed'))).toBeNull();
  });
});

describe('shouldFireConfetti', () => {
  it('fires on null → non-null (the ending moment)', () => {
    expect(shouldFireConfetti(null, 'oak-legacy')).toBe(true);
  });

  it('does not fire when the ending is unchanged', () => {
    expect(shouldFireConfetti('oak-legacy', 'oak-legacy')).toBe(false);
  });

  it('does not fire on dismiss (non-null → null)', () => {
    expect(shouldFireConfetti('oak-legacy', null)).toBe(false);
  });

  it('does not fire when there was no ending and still none', () => {
    expect(shouldFireConfetti(null, null)).toBe(false);
  });
});

describe('spawnBurst', () => {
  it('spawns CONFETTI_COUNT rect particles for confetti', () => {
    const ps: Particle[] = [];
    spawnBurst(ps, 'confetti', 800, 600, false);
    expect(ps).toHaveLength(CONFETTI_COUNT);
    expect(ps.every((p) => p.shape === 'rect')).toBe(true);
  });

  it('spawns COIN_COUNT circle particles for coin-shower', () => {
    const ps: Particle[] = [];
    spawnBurst(ps, 'coin-shower', 800, 600, false);
    expect(ps).toHaveLength(COIN_COUNT);
    expect(ps.every((p) => p.shape === 'circle')).toBe(true);
  });

  it('spawns LEAF_COUNT leaf particles for leaf-fall', () => {
    const ps: Particle[] = [];
    spawnBurst(ps, 'leaf-fall', 800, 600, false);
    expect(ps).toHaveLength(LEAF_COUNT);
    expect(ps.every((p) => p.shape === 'leaf')).toBe(true);
  });

  it('spawns nothing when reduced motion is requested (accessibility)', () => {
    const ps: Particle[] = [];
    spawnBurst(ps, 'confetti', 800, 600, true);
    spawnBurst(ps, 'coin-shower', 800, 600, true);
    spawnBurst(ps, 'leaf-fall', 800, 600, true);
    expect(ps).toHaveLength(0);
  });

  it('places confetti across the full width but coins/leaves near center', () => {
    const confetti: Particle[] = [];
    spawnBurst(confetti, 'confetti', 800, 600, false);
    // confetti x-coordinates span the full width (at least one near each edge third)
    const xs = confetti.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(800 / 3);
    expect(Math.max(...xs)).toBeGreaterThan((800 * 2) / 3);

    const coins: Particle[] = [];
    spawnBurst(coins, 'coin-shower', 800, 600, false);
    // coins cluster near the center (within ~150px of cx=400)
    expect(coins.every((p) => Math.abs(p.x - 400) < 160)).toBe(true);
  });
});

describe('updateParticle', () => {
  it('keeps an alive particle alive + advances it', () => {
    const p: Particle = makeParticle({ life: 1, y: 10 });
    const alive = updateParticle(p, 0.1, 600);
    expect(alive).toBe(true);
    expect(p.life).toBeLessThan(1); // life decreased
    expect(p.y).toBeGreaterThan(10); // fell (gravity)
  });

  it('kills a particle whose life ran out', () => {
    const p: Particle = makeParticle({ life: 0.05, y: 10 });
    expect(updateParticle(p, 0.1, 600)).toBe(false);
  });

  it('kills a particle that fell past the bottom of the canvas', () => {
    const p: Particle = makeParticle({ life: 5, y: 650 });
    expect(updateParticle(p, 0.1, 600)).toBe(false);
  });
});

describe('ParticleFlourishes component', () => {
  it('mounts a fixed pointer-events-none canvas overlay', () => {
    const { getByTestId } = render(<ParticleFlourishes />);
    const canvas = getByTestId('particle-flourishes');
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.className).toContain('pointer-events-none');
    expect(canvas.className).toContain('fixed');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
  });
});

// ─── test helpers ────────────────────────────────────────────────────────────

/** Build a harvest-completed event with only the fields classifyEvent reads. */
function harvestEvent(leaves: number): SimulationEvent {
  return {
    type: 'harvest-completed',
    at: 1000,
    payload: {
      treeId: 'tree-1',
      result: { leavesHarvested: leaves },
    },
  } as unknown as SimulationEvent;
}

/** Build a non-harvest event (classifyEvent returns null for these). */
function otherEvent(type: string): SimulationEvent {
  return { type, at: 1, payload: {} } as unknown as SimulationEvent;
}

/** Build a minimal particle for updateParticle tests. */
function makeParticle(overrides: Partial<Particle>): Particle {
  return {
    x: 400,
    y: 10,
    vx: 0,
    vy: 0,
    gravity: 200,
    rotation: 0,
    vr: 0,
    color: '#fff',
    shape: 'rect',
    size: 8,
    life: 1,
    maxLife: 1,
    swayAmp: 0,
    swayFreq: 0,
    swayPhase: 0,
    ...overrides,
  };
}
