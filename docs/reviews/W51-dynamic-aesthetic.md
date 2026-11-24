# W51 — Dynamic aesthetic shift (brutalist → neutral → floral)

**Status:** merged to main (`9d74f23`).
**Design spec:** [`download/capitalist-tree-aesthetic-shift-mockup.html`](../../../download/capitalist-tree-aesthetic-shift-mockup.html) — a 10-stage mockup showing the full progression.

The entire UI migrates from a brutalist industrial theme (concrete, steel,
yellowed canopy, monospace) at full **exploitation** (score 0) through a neutral
midpoint at the balanced **start** (score 5) to the botanical field-journal
theme (parchment, ink, leaf-green, serif) at full **sustainability** (score 10),
driven by a 0–10 stewardship score derived from the live simulation state.

## The score (`apps/web/lib/aesthetic/score.ts`)

A **stewardship-balance** metric, not a raw ecology-quality metric. The sim
starts PRISTINE (health 1, resilience 0.8, biodiversity 0.8, soil 1, airQuality
1, 50 leaves, zero extraction) — a naive ecology average would start at ~0.9
(score ~9), NOT 5. So the score is anchored to **deviations from the balanced
start**, not absolute ecology quality:

```
score = clamp(5
  + canopyGrowthBonus      // +0..5: leaves grown beyond the 50-leaf sapling start
  - canopyLossPenalty       // -0..2.5: leaves harvested below the start
  - ecoDamagePenalty,       // -0..2.5: ecological degradation
  0, 10)                    // integer-rounded
```

A pristine untouched sapling = 5 (you've done nothing). Growing the canopy
toward full raises it to 10. Over-harvesting + ecological degradation lower it
to 0.

**The start-anchor problem + fix.** The first version used `(1 - tree.health)`
and the seeded pristine values (0.8/0.8/1.0) as baselines — but the live app
booted to score **4**, not 5. Diagnosis (via a temporary debug stash on
`window`): `tree.health` is **derived** (recomputed each tick by BiologySystem
from stress/reserves/foliage) and drops from the seeded 1.0 immediately; and
`ecosystemResilience` / `biodiversity.index` / `soil.health` **settle** below
their seeded values after the first tick (to ~0.55 / 0.68 / 0.64) and stay
there. So those aren't stable anchors. The fix:

- **Drop `tree.health`** — it double-counts the foliage signal (already in the
  canopy terms) and drifts at start.
- **Use a 0.5 threshold** for resilience / biodiversity / soil.health: no
  penalty while above 0.5 (the settled start ~0.55–0.68 is above it → score 5),
  only severe degradation below 0.5 penalizes. This is robust to the sim's
  start-time drift without hardcoding the emergent equilibrium values.
- `airQuality` (1 = clean), `soil.contamination`, `landUse.degraded` are direct
  exploitation-footprint signals (zero at the pristine start).

Verified live: the app boots to exactly score 5 (`data-aesthetic="5"`, meter
"5/10", neutral palette).

## The palette (`apps/web/lib/aesthetic/palette.ts`)

13 var-ified tokens (parchment / ink / leaf / bark / brass × shades) interpolated
**linearly** in RGB between a brutalist endpoint (concrete / steel / yellowed
canopy) and the **floral endpoint = the existing W48 field-journal hex** — so at
score 10 the app looks identical to the pre-W51 look (no regression at full
sustainability). The `:root` defaults in `globals.css` are
`interpolatePalette(5)` — byte-identical to the hook's first client write (no
theme flash on hydration).

The **steward accent** is **piecewise** red → brass → green (score 0 / 5 / 10),
exposed as the `--ct-steward` var + `steward` Tailwind color, used only by the
meter. Piecewise (not linear) so the midpoint reads as gold, not muddy brown.

**`accent` (rust) stays a FIXED literal.** It is the app's error/warning color
(insufficient-funds, dead-tree warning, severe-weather, damage types — 24+
usages) and must not shift: an "insufficient funds" message rendering green at
full sustainability would be semantically wrong.

## The hook (`apps/web/hooks/useAestheticTheme.ts`)

Mounts once in `HomePage`. On each integer-score change, writes the `--ct-*`
palette vars + `--ct-steward` + `--ct-font-body` (the active font stack) onto
`<html>`, and stamps `data-aesthetic` (0–10) + `data-aesthetic-tier`
(brutalist/neutral/floral) for future discrete CSS hooks. No-op during SSR /
pre-boot (the `:root` defaults render the neutral palette). The score selector
returns a primitive integer → the hook only re-renders when the score actually
changes (not every tick).

## Var-ification — the whole app re-themes, zero component edits

The W48 field-journal colors (parchment / ink / leaf / bark / brass, ~430 usages
across `text-ink-soft` 151×, `text-ink` 112×, `border-ink` 87×, `bg-parchment`
42×, etc.) now resolve to `rgb(var(--ct-X) / <alpha-value>)`. Every opacity
modifier (`bg-parchment/45`, `border-ink/25`) is preserved. Swapping the vars on
`<html>` re-themes the entire app — panels, buttons, stat chips, inputs, the
meter, the tree canvas border, the paper grain (stain color follows `--ct-ink`).

Three font tiers via `var(--ct-font-body)`:
- **Brutalist** (score ≤3): `"Courier New", monospace` — the extractive ledger.
- **Neutral** (4–6): `system-ui` sans — the balanced operating state.
- **Floral** (>6): the W48 Georgia serif — the naturalist's notebook.

`font-journal` (Courier mono "annotation readout") stays a fixed literal.

## The meter (`apps/web/components/dashboard/AestheticMeter.tsx`)

A compact readout in the page header: 10 pips (filled up to the score) + a
`score/10` numeric + the tier label (Exploitation / Balanced / Sustainability).
Pip + number color follows `--ct-steward`. Returns `null` pre-boot so the header
layout is stable during loading.

## Verification

- **Typecheck:** web clean.
- **Tests:** 36 new tests across 4 files — `score.test.ts` (8: pristine=5, full
  canopy=10, collapse=0, monotonic, clamping, integer), `palette.test.ts` (16:
  endpoints, score=5 = `:root` defaults, steward piecewise, lerpTriple),
  `fonts.test.ts` (7: tier thresholds, stacks, labels), `AestheticMeter.test.tsx`
  (5: null pre-boot, pristine=5/neutral, 10 pips, brutalist/floral tiers).
- **Full suite:** 1970 (110 files, 0 errors) + `climate-effect-wiring.test.ts`
  19/19 isolated (the heavy 90-day climate sims OOM a vitest worker under
  parallel load — a pre-existing infra sensitivity, unrelated to W51).
- **Production build:** packages + Next.js green (page 33.5 kB).
- **Live visual check:** neutral@5 start = bg `rgb(145,141,131)`, meter "5/10",
  10 pips, neutral tier; brutalist@0 = bg `rgb(46,46,46)` (concrete); floral@10 =
  bg `rgb(244,236,216)` (parchment, the W48 look). PIL non-blank ratio 1.000 for
  all three.

## Files

| file | role |
|---|---|
| `apps/web/lib/aesthetic/score.ts` | `computeSustainabilityScore(state)` — the 0–10 score |
| `apps/web/lib/aesthetic/palette.ts` | brutalist/floral endpoints, `interpolatePalette`, `interpolateSteward`, `lerpTriple` |
| `apps/web/lib/aesthetic/fonts.ts` | 3 font tiers + `fontTierForScore` + labels |
| `apps/web/hooks/useAestheticTheme.ts` | writes the vars + font + attrs onto `<html>` |
| `apps/web/components/dashboard/AestheticMeter.tsx` | the header meter (pips + score + tier) |
| `apps/web/stores/game-store.ts` | `selectSustainabilityScore` selector |
| `apps/web/tailwind.config.mjs` | 5 colors var-ified, `accent` fixed, `steward` added, `font-serif` → var |
| `apps/web/app/globals.css` | `:root` defaults = score-5 palette, var-driven body + grain |
| `apps/web/app/page.tsx` | mounts the hook + renders the meter |
| `apps/web/test/lib/aesthetic/{score,palette,fonts}.test.ts` + `test/components/dashboard/AestheticMeter.test.tsx` | 36 tests |

## Follow-ups (future W items)

| idea | notes |
|---|---|
| **Border-radius shift** | sharp corners at brutalist, soft at floral — a `--ct-radius` var + Tailwind `borderRadius` remap (the mockup bakes `rad = lerp(0, 6, t)` in). |
| **Tier decorative overlay** | a `data-aesthetic-tier`-keyed `body::after` — diagonal industrial hatch at brutalist, sunlit corner pools at floral. |
| **Canopy density scaling** | the renderer's `foliageDensity` (`packages/rendering/src/tree-render-data.ts:188`) could be post-multiplied by a score factor in `page.tsx`'s `useMemo` so the drawn canopy lushness tracks the score. |
| **Smokestacks / sun / haze** | the mockup draws smokestacks (score ≤3), a sun (≥7), + pollution haze (≤5) in the tree scene — rendering-package work. |
| **Distinctive fonts via `next/font/google`** | self-hosted brutalist/floral faces — but adds a build-time network dependency (the current generic stacks are build-network-independent). |
| **Var-ify the sky/teal weather tones** | the legacy Tailwind weather/cyan accents stay literal; a follow-up could shift them too. |
| **Per-tick drift** | a System that gently pulls the score toward the derived ecology so a neglected tree decays toward exploitation even without explicit actions. |
