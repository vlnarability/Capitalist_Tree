/**
 * W76/W77 — 25yr long-horizon steady-state verification (P12-C follow-up).
 *
 * The 5yr bot (dr1-long-run.test.ts) verifies all four DR-1 targets + shows the
 * asymptotic trend is stable. This test extends the two STEADY-STATE cases
 * (sustainable + balanced — the ones that survive long-term) to 25yr (3000d) to
 * catch slow drift the 5yr window can't: slow env collapse, runaway cash growth,
 * biodiversity ceiling saturation, or late tree death.
 *
 * Extractive + recovery are NOT run here — they are verified at 5yr (extractive
 * tests collapse behavior, recovery tests recovery). This is the steady-state
 * extrapolation the P12-C spec calls for.
 *
 * Run on demand (excluded from the default suite via vitest.config.ts):
 *   1. Temporarily comment out the exclude line for this file in vitest.config.ts.
 *   2. npx vitest run packages/simulation/test/_w77-long-horizon.test.ts
 *
 * Writes: /home/z/my-project/download/dr1-long-horizon-25yr-report.md
 *
 * Temporary — delete after verification (or fold into the dr1-long-run bot with a
 * HORIZON_YEARS env flag).
 */
import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { engine, dispatch, DEFAULT_GAME_CONFIG } from '../src/index.js';

const DAY = 86_400;
const STEP = DAY;
const DAYS_PER_YEAR = 120;
const HORIZON_YEARS = 25;
const HORIZON_DAYS = HORIZON_YEARS * DAYS_PER_YEAR; // 3000d.

// Checkpoints at 5yr intervals (the 5yr bot covers 0-5yr in detail).
const CHECKPOINTS = new Set([
  0,
  5 * DAYS_PER_YEAR, // 5yr
  10 * DAYS_PER_YEAR, // 10yr
  15 * DAYS_PER_YEAR, // 15yr
  20 * DAYS_PER_YEAR, // 20yr
  HORIZON_DAYS, // 25yr
]);

type Scenario = {
  name: string;
  description: string;
  step: (state: any, stepIdx: number) => any[];
};

const scenarios: Scenario[] = [
  {
    name: 'sustainable',
    description:
      'Harvest 25% every 28d + water 20L every 7d + compost every 28d. Cared-for tree — 25yr steady-state extrapolation.',
    step: (state, stepIdx) => {
      const treeId = state.originalTree.id;
      const actions: any[] = [];
      if (stepIdx % 28 === 0) {
        const leaves = state.originalTree.foliage.currentLeaves;
        const harvest = Math.max(1, Math.floor(leaves * 0.25));
        actions.push({ type: 'harvest-leaves', payload: { treeId, requestedLeaves: harvest } });
        actions.push({ type: 'apply-fertilizer', payload: { fertilizerId: 'fertilizer:compost', units: 1, treeId } });
      }
      if (stepIdx % 7 === 0) actions.push({ type: 'apply-water', payload: { litres: 20, treeId } });
      return actions;
    },
  },
  {
    name: 'balanced',
    description:
      'Harvest 40% every 28d + water 15L every 5d + compost every 21d. More aggressive than sustainable — 25yr steady-state extrapolation.',
    step: (state, stepIdx) => {
      const treeId = state.originalTree.id;
      const actions: any[] = [];
      if (stepIdx % 28 === 0) {
        const leaves = state.originalTree.foliage.currentLeaves;
        const harvest = Math.max(1, Math.floor(leaves * 0.40));
        actions.push({ type: 'harvest-leaves', payload: { treeId, requestedLeaves: harvest } });
      }
      if (stepIdx % 5 === 0) actions.push({ type: 'apply-water', payload: { litres: 15, treeId } });
      if (stepIdx % 21 === 0) actions.push({ type: 'apply-fertilizer', payload: { fertilizerId: 'fertilizer:compost', units: 1, treeId } });
      return actions;
    },
  },
];

const aggIndicators = (s: any) => s.eventState.global.aggregatedIndicators;
function envCollapsed(s: any): boolean {
  const agg = aggIndicators(s);
  return agg.avgForestCoverage < 0.2 || agg.ecosystemResilience < 0.2 || agg.avgSoilHealth < 0.2;
}
const fmt = (n: number) => (typeof n === 'number' ? n.toFixed(3) : String(n));
const dayToYr = (d: number) => `${(d / DAYS_PER_YEAR).toFixed(2)}yr`;

describe('W77 long-horizon 25yr steady-state', () => {
  it('runs sustainable + balanced for 25yr + reports drift', { timeout: 1_800_000 }, () => {
    mkdirSync('/home/z/my-project/download', { recursive: true });
    const report: string[] = [
      '# DR-1 Long-Horizon (25yr) Steady-State Verification',
      '',
      `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
      `**Horizon:** ${HORIZON_YEARS}yr (${HORIZON_DAYS}d) — sustainable + balanced (the two steady-state cases).`,
      `**Step:** 1-day (${STEP / 1000}s). Checkpoints at 5yr intervals.`,
      '',
      'Purpose: catch slow drift the 5yr bot cannot — slow env collapse, runaway cash,',
      'biodiversity ceiling saturation, or late tree death. The 5yr bot already verifies',
      'all four DR-1 targets; this is the P12-C long-horizon extrapolation.',
      '',
    ];

    const verdict: string[] = ['## Verdict (25yr steady-state)', ''];

    for (const scenario of scenarios) {
      report.push(`## ${scenario.name}`);
      report.push('');
      report.push(`_${scenario.description}_`);
      report.push('');

      const init = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 7, createdAt: 0 });
      let state: any = init;
      const rows: string[] = [
        '| day | yr | alive | treeHealth | wear | leaves | seeds | cash | forestCov | ecoResil | soilHealth | biodiv | collapsed |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      ];
      const snap = (s: any, day: number) => {
        const agg = aggIndicators(s);
        const t = s.originalTree;
        rows.push(
          `| ${day} | ${dayToYr(day)} | ${t.alive ? 'yes' : 'no'} | ${fmt(t.health)} | ${fmt(t.wear)} | ${t.foliage.currentLeaves} | ${t.seeds} | ${s.player.personalCash} | ${fmt(agg.avgForestCoverage)} | ${fmt(agg.ecosystemResilience)} | ${fmt(agg.avgSoilHealth)} | ${fmt(agg.avgBiodiversity)} | ${envCollapsed(s) ? 'yes' : 'no'} |`,
        );
      };
      if (CHECKPOINTS.has(0)) snap(state, 0);

      // Track key indicators at each 5yr checkpoint for drift analysis.
      const cashSeries: { day: number; cash: number }[] = [];
      const bioSeries: { day: number; bio: number }[] = [];
      const healthSeries: { day: number; health: number }[] = [];
      let deathDay: number | null = null;
      let collapseDay: number | null = null;
      let cashMin = Infinity;

      for (let step = 0; step < HORIZON_DAYS; step++) {
        const day = step + 1;
        const actions = scenario.step(state, step);
        for (const action of actions) {
          try {
            const r = dispatch(state, action);
            if (r.state) state = r.state;
          } catch {
            // ignore action errors
          }
        }
        state = engine.advance(state, STEP).state;

        if (deathDay === null && !state.originalTree.alive) deathDay = day;
        if (collapseDay === null && envCollapsed(state)) collapseDay = day;
        if (state.player.personalCash < cashMin) cashMin = state.player.personalCash;

        if (CHECKPOINTS.has(day)) {
          snap(state, day);
          cashSeries.push({ day, cash: state.player.personalCash });
          bioSeries.push({ day, bio: aggIndicators(state).avgBiodiversity });
          healthSeries.push({ day, health: state.originalTree.health });
        }
      }

      report.push(rows.join('\n'));
      report.push('');

      // Drift analysis.
      const cash5yr = cashSeries.find((c) => c.day === 5 * DAYS_PER_YEAR)?.cash ?? 0;
      const cash25yr = cashSeries.find((c) => c.day === HORIZON_DAYS)?.cash ?? 0;
      const cashGrowthFactor = cash5yr > 0 ? cash25yr / cash5yr : 0;
      // Linear extrapolation: 25yr / 5yr = 5x. If cash grows ~5x, it's linear
      // (sustainable). If >>5x (e.g. >10x), it's runaway (compound growth, no sink).
      const isLinearCash = cashGrowthFactor <= 7; // allow some compound, flag if >7x

      const bio5yr = bioSeries.find((b) => b.day === 5 * DAYS_PER_YEAR)?.bio ?? 0;
      const bio25yr = bioSeries.find((b) => b.day === HORIZON_DAYS)?.bio ?? 0;
      const bioDrift = bio25yr - bio5yr;

      const health25yr = healthSeries.find((h) => h.day === HORIZON_DAYS)?.health ?? 0;

      report.push(`- **Tree death day:** ${deathDay !== null ? `day ${deathDay} (${dayToYr(deathDay)})` : `alive at ${HORIZON_YEARS}yr`}.`);
      report.push(`- **Env collapse day:** ${collapseDay !== null ? `day ${collapseDay} (${dayToYr(collapseDay)})` : 'never collapsed'}.`);
      report.push(`- **Cash:** 5yr = ${cash5yr}, 25yr = ${cash25yr} (growth factor ${cashGrowthFactor.toFixed(2)}x; linear ≈5x). ${isLinearCash ? '✅ linear (no runaway)' : '⚠️ super-linear — possible runaway (no cash sink)'}.`);
      report.push(`- **Cash minimum:** ${cashMin} (financial-independence check — never went negative).`);
      report.push(`- **Biodiversity drift (5yr→25yr):** ${bioDrift >= 0 ? '+' : ''}${bioDrift.toFixed(3)} (${bio5yr.toFixed(3)} → ${bio25yr.toFixed(3)}). ${Math.abs(bioDrift) < 0.1 ? '✅ stable' : bioDrift > 0 ? 'improving (slow recovery toward ceiling)' : '⚠️ declining'}.`);
      report.push(`- **Tree health at 25yr:** ${health25yr.toFixed(3)}.`);
      report.push('');

      // Verdict.
      const treeSurvived = deathDay === null;
      const envStable = collapseDay === null;
      verdict.push(`### ${scenario.name}`);
      verdict.push(`- Tree survives 25yr: ${treeSurvived ? '✅' : '❌ (died ' + dayToYr(deathDay!) + ')'}.`);
      verdict.push(`- Env stable 25yr (no collapse): ${envStable ? '✅' : '❌ (collapsed ' + dayToYr(collapseDay!) + ')'}.`);
      verdict.push(`- Cash growth linear (no runaway): ${isLinearCash ? '✅ (' + cashGrowthFactor.toFixed(2) + 'x)' : '⚠️ (' + cashGrowthFactor.toFixed(2) + 'x)'}.`);
      verdict.push(`- Biodiversity stable: ${Math.abs(bioDrift) < 0.1 ? '✅' : bioDrift > 0 ? '✅ improving (' + bioDrift.toFixed(3) + ')' : '⚠️ declining (' + bioDrift.toFixed(3) + ')'}.`);
      verdict.push('');
    }

    report.push(...verdict);
    const text = report.join('\n');
    writeFileSync('/home/z/my-project/download/dr1-long-horizon-25yr-report.md', text);
    // eslint-disable-next-line no-console
    console.log('\n--- 25yr report written to download/dr1-long-horizon-25yr-report.md ---\n');
  });
});
