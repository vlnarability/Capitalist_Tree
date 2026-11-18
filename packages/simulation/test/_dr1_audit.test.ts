import { describe, it, expect } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '../src/index.js';

const SECONDS_PER_DAY = 24 * 60 * 60;
const DAY = SECONDS_PER_DAY;

/**
 * DR-1 balance audit — measures the current @provisional constants against the
 * DR-1 real-time targets (docs/reviews/DECISIONS.md):
 *   - Neglect death: 6–12 months (180–365 days)
 *   - Financial independence: 30–60 days
 *   - Ecological collapse under sustained exploitation: 2–4 years
 *   - Ecological recovery: 1–5+ years
 *
 * This is a lite version of the P12-C design-promise bot: run the sim idle
 * (no player actions = "neglect") + measure the tree + currency trajectory.
 */
describe('DR-1 balance audit — neglect + financial trajectory', () => {
  it('idle sim: tree state at 1/3/7/10 days (trajectory read)', () => {
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42, createdAt: 0 });
    let state = s;
    const checkpoints = [1, 3, 7, 10];
    const results: string[] = [];
    let nextIdx = 0;
    for (let day = 0; day <= 10; day += 1) {
      if (nextIdx < checkpoints.length && day >= checkpoints[nextIdx]!) {
        const t = state.originalTree;
        const cur = state.economy?.currency ?? state.personal?.currency ?? 0;
        results.push(
          `day ${day}: alive=${t.alive} stress=${t.stress.toFixed(3)} health=${t.health.toFixed(3)} height=${t.structure.height.toFixed(2)} trunkDiam=${t.structure.trunkDiameter.toFixed(3)} reserves=${t.energy.reserves.toFixed(1)} leaves=${t.foliage.currentLeaves} water=${t.water.stored.toFixed(1)}/${t.water.capacity.toFixed(1)} currency=${cur}`,
        );
        nextIdx++;
      }
      if (day < 10) state = engine.advance(state, DAY).state;
    }
    console.error('DR-1 audit (idle, seed 42, 10 days):\n' + results.join('\n'));
    // DR-1 lower bound: a neglected tree survives at least 10 days (the target
    // is 6–12 months; 10 days is a weak floor that catches gross mortality
    // regressions). The tree is alive at day 10 per the trajectory above.
    // Stress reaching 1.0 by day 3 is the known misalignment documented in
    // DECISIONS.md DR-1 (neglect death ~1–2mo vs 6–12mo target — 3–6× too fast).
    expect(state.originalTree.alive).toBe(true);
  });
});
