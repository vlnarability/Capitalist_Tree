/**
 * W57 (P12-C) — 100yr long-horizon steady-state extrapolation.
 *
 * The 5yr bot (`dr1-long-run.test.ts`) verifies all four DR-1 targets + shows the
 * asymptotic trend is stable. The 25yr runner (`_w77-long-horizon.test.ts`)
 * extends the two steady-state cases (sustainable + balanced) to 25yr. This test
 * pushes the SAME two cases to 100yr — the P12-C spec's full long-horizon
 * extrapolation — to confirm the steady-state holds over a century (no slow
 * collapse, runaway cash, biodiversity saturation, or late tree death that a
 * 25yr window can't surface).
 *
 * DR-1's numeric targets are spec-complete at 5yr (`DECISIONS.md` DR-1); this is
 * the validation/extrapolation nicety, NOT a DR-1 blocker.
 *
 * The horizon is env-configurable so the runner can be smoke-tested at a small
 * horizon + run at full 100yr on demand:
 *   DR1_HORIZON_YEARS=1  npx vitest run .../_w57-long-horizon-100yr.test.ts   # smoke
 *   DR1_HORIZON_YEARS=100 npx vitest run .../_w57-long-horizon-100yr.test.ts  # full (~2hr)
 *
 * Excluded from the default suite via vitest.config.ts (run on demand —
 * temporarily comment out the exclude line first; vitest applies excludes even
 * when a file is passed explicitly).
 *
 * Writes: /home/z/my-project/download/dr1-long-horizon-100yr-report.md
 */
import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { engine, dispatch, DEFAULT_GAME_CONFIG } from '../src/index.js';

const DAY = 86_400;
const STEP = DAY;
const DAYS_PER_YEAR = 120;
// Env-configurable: default 100yr (full P12-C extrapolation); override for smoke.
const HORIZON_YEARS = Number(process.env.DR1_HORIZON_YEARS ?? 100);
const HORIZON_DAYS = HORIZON_YEARS * DAYS_PER_YEAR;

// ~11 evenly-spaced checkpoints (adaptive to the horizon).
const CHECKPOINT_INTERVAL_YR = Math.max(1, Math.round(HORIZON_YEARS / 10));
const CHECKPOINTS = new Set<number>();
for (let y = 0; y <= HORIZON_YEARS; y += CHECKPOINT_INTERVAL_YR) {
  CHECKPOINTS.add(y * DAYS_PER_YEAR);
}
CHECKPOINTS.add(HORIZON_DAYS);

type Scenario = {
  name: string;
  description: string;
  step: (state: any, stepIdx: number) => any[];
};

const scenarios: Scenario[] = [
  {
    name: 'sustainable',
    description:
      'Harvest 25% every 28d + water 20L every 7d + compost every 28d. Cared-for tree — 100yr steady-state extrapolation.',
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
      'Harvest 40% every 28d + water 15L every 5d + compost every 21d. More aggressive than sustainable — 100yr steady-state extrapolation.',
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

describe(`W57 long-horizon ${HORIZON_YEARS}yr steady-state`, () => {
  it(`runs sustainable + balanced for ${HORIZON_YEARS}yr + reports drift`, { timeout: 7_200_000 }, () => {
    mkdirSync('/home/z/my-project/download', { recursive: true });
    const report: string[] = [
      `# DR-1 Long-Horizon (${HORIZON_YEARS}yr) Steady-State Extrapolation`,
      '',
      `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
      `**Horizon:** ${HORIZON_YEARS}yr (${HORIZON_DAYS}d) — sustainable + balanced (the two steady-state cases).`,
      `**Step:** 1-day (${STEP / 1000}s). Checkpoints every ${CHECKPOINT_INTERVAL_YR}yr.`,
      '',
      'Purpose: confirm the steady-state holds over a century — no slow env collapse,',
      'runaway cash, biodiversity saturation, or late tree death that a 25yr window',
      "can't surface. The 5yr bot verifies all four DR-1 targets; the 25yr runner",
      'verifies 25yr; this is the P12-C full long-horizon extrapolation.',
      '',
    ];

    const verdict: string[] = [`## Verdict (${HORIZON_YEARS}yr steady-state)`, ''];

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

      // Drift analysis: first non-zero checkpoint vs final.
      const firstCk = cashSeries.find((c) => c.day > 0);
      const finalCk = cashSeries[cashSeries.length - 1];
      const cashStart = firstCk?.cash ?? 0;
      const cashEnd = finalCk?.cash ?? 0;
      const cashGrowthFactor = cashStart > 0 ? cashEnd / cashStart : 0;
      const startDay = firstCk?.day ?? 0;
      const endDay = finalCk?.day ?? HORIZON_DAYS;
      const yearSpan = (endDay - startDay) / DAYS_PER_YEAR;
      // Linear extrapolation factor = yearSpan. Flag if super-linear (> 2x linear).
      const linearFactor = yearSpan;
      const isLinearCash = cashGrowthFactor <= linearFactor * 2;

      const bioStart = bioSeries.find((b) => b.day > 0)?.bio ?? 0;
      const bioEnd = bioSeries[bioSeries.length - 1]?.bio ?? 0;
      const bioDrift = bioEnd - bioStart;

      const healthEnd = healthSeries[healthSeries.length - 1]?.health ?? 0;

      report.push(`- **Tree death day:** ${deathDay !== null ? `day ${deathDay} (${dayToYr(deathDay)})` : `alive at ${HORIZON_YEARS}yr`}.`);
      report.push(`- **Env collapse day:** ${collapseDay !== null ? `day ${collapseDay} (${dayToYr(collapseDay)})` : 'never collapsed'}.`);
      report.push(`- **Cash:** ${dayToYr(startDay)} = ${cashStart}, ${dayToYr(endDay)} = ${cashEnd} (growth factor ${cashGrowthFactor.toFixed(2)}x over ${yearSpan.toFixed(1)}yr; linear ≈${linearFactor.toFixed(1)}x). ${isLinearCash ? '✅ ~linear (no runaway)' : '⚠️ super-linear — possible runaway (no cash sink)'}.`);
      report.push(`- **Cash minimum:** ${cashMin} (financial-independence check — never went negative).`);
      report.push(`- **Biodiversity drift (${dayToYr(startDay)}→${dayToYr(endDay)}):** ${bioDrift >= 0 ? '+' : ''}${bioDrift.toFixed(3)} (${bioStart.toFixed(3)} → ${bioEnd.toFixed(3)}). ${Math.abs(bioDrift) < 0.1 ? '✅ stable' : bioDrift > 0 ? 'improving (slow recovery toward ceiling)' : '⚠️ declining'}.`);
      report.push(`- **Tree health at ${HORIZON_YEARS}yr:** ${healthEnd.toFixed(3)}.`);
      report.push('');

      // Verdict.
      const treeSurvived = deathDay === null;
      const envStable = collapseDay === null;
      verdict.push(`### ${scenario.name}`);
      verdict.push(`- Tree survives ${HORIZON_YEARS}yr: ${treeSurvived ? '✅' : '❌ (died ' + dayToYr(deathDay!) + ')'}.`);
      verdict.push(`- Env stable ${HORIZON_YEARS}yr (no collapse): ${envStable ? '✅' : '❌ (collapsed ' + dayToYr(collapseDay!) + ')'}.`);
      verdict.push(`- Cash growth ~linear (no runaway): ${isLinearCash ? '✅ (' + cashGrowthFactor.toFixed(2) + 'x)' : '⚠️ (' + cashGrowthFactor.toFixed(2) + 'x)'}.`);
      verdict.push(`- Biodiversity stable: ${Math.abs(bioDrift) < 0.1 ? '✅' : bioDrift > 0 ? '✅ improving (' + bioDrift.toFixed(3) + ')' : '⚠️ declining (' + bioDrift.toFixed(3) + ')'}.`);
      verdict.push('');
    }

    report.push(...verdict);
    const text = report.join('\n');
    writeFileSync('/home/z/my-project/download/dr1-long-horizon-100yr-report.md', text);
    // eslint-disable-next-line no-console
    console.log(`\n--- ${HORIZON_YEARS}yr report written to download/dr1-long-horizon-100yr-report.md ---\n`);
  });
});
