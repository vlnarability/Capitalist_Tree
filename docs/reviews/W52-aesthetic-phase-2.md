# W52 — Aesthetic phase 2: corner-radius shift + canopy-density scaling

**Status:** merged to main (`4d78452`).
**Parent:** W51 — dynamic aesthetic shift (`9d74f23`). This W completes the
non-color visual language of the brutalist → neutral → floral progression that
W51 established (palette + fonts).

W51's review queued seven follow-ups. This W delivers the two highest-value,
mockup-specified, no-regression-safe ones — **shape** (corner radius) and
**canopy** (drawn density) — and explicitly **rejects** a third (weather/sky
tone var-ification) after investigation. The remaining four follow-ups stay
queued for future W-items.

Both pieces inherit W51's hard invariant: **at score 10 (full sustainability)
the app looks identical to the pre-W52 look** — no regression at the floral
end. The visible shift happens toward the brutalist end (score 0).

## W52-a — Corner-radius shift (`--ct-radius`)

A new CSS variable `--ct-radius`, interpolated linearly by the sustainability
score: `0rem` (sharp) at brutalist (score 0) → `0.25rem` at floral (score 10).
The score-5 (neutral) midpoint is `0.125rem`, which is the `:root` default in
`globals.css` — byte-identical to `interpolateRadius(5)`, so SSR matches the
hook's first client write (no theme flash on hydration, same discipline as
W51's palette).

**Tailwind `borderRadius` remap.** Every radius token is re-derived as a
multiple of `--ct-radius`, matching Tailwind's native DEFAULT-relative scale:

| token | value | × DEFAULT |
|---|---|---|
| `rounded-sm` | `calc(var(--ct-radius) * 0.5)` | 0.5× |
| `rounded` (DEFAULT) | `var(--ct-radius)` | 1× |
| `rounded-md` | `calc(var(--ct-radius) * 1.5)` | 1.5× |
| `rounded-lg` | `calc(var(--ct-radius) * 2)` | 2× |
| `rounded-xl` | `calc(var(--ct-radius) * 3)` | 3× |
| `rounded-2xl` | `calc(var(--ct-radius) * 4)` | 4× |
| `rounded-3xl` | `calc(var(--ct-radius) * 6)` | 6× |
| `rounded-full` / `rounded-none` | literal (`9999px` / `0`) | — |

**The no-regression math.** At score 10, `--ct-radius = 0.25rem` = Tailwind's
`rounded` DEFAULT base (4px). So every token resolves to its original Tailwind
value: `sm`=0.125rem, DEFAULT=0.25rem, `md`=0.375rem, `lg`=0.5rem, `xl`=0.75rem,
`2xl`=1rem, `3xl`=1.5rem — byte-identical to the pre-W52 scale. At score 0,
`--ct-radius = 0` so every corner goes sharp (industrial). `rounded-full` stays
`9999px` (pips, progress bars, avatars must stay circular) and `rounded-none`
stays `0`.

**Verified live** (chromium, the running production build): the computed
`border-radius` of a `.rounded-lg` panel is **0px at brutalist@0**, **4px at
neutral@5** (0.125rem × 2), and **8px at floral@10** (= 0.25rem × 2 = the
original Tailwind `lg`). The 0 → 8px shift across the score is clearly visible
on every panel, card, and input; the floral end is unchanged.

## W52-b — Canopy-density scaling

The renderer's `TreeRenderData.foliageDensity` (`currentLeaves / leafCapacity`,
∈ [0,1]) is post-multiplied by a score-derived factor in `page.tsx`'s render-data
`useMemo`, so the **drawn** canopy lushness tracks the stewardship score — a
sparse, thinning canopy at exploitation, a full canopy at sustainability.

`canopyDensityScale(score)` is linear: **0.7 at brutalist (score 0)** → **1.0
at floral (score 10)**, midpoint 0.85 at neutral (score 5). Applied as
`foliageDensity * canopyDensityScale(score)` (then re-clamped to [0,1]
defensively). `buildTreeRenderData` returns a fresh object each call, so the
spread override `{ ...base, foliageDensity }` does not mutate any cached
snapshot (rule 2 purity preserved).

**The no-inflation invariant.** The scale NEVER exceeds 1.0, so the canopy is
never drawn fuller than the simulation says it is — it can only be **thinned
for mood**. At score 10 the factor is 1.0 → the drawn canopy = the real
leaf-count density → no regression at the floral end. At score 0 the factor is
0.7 → the drawn canopy is 30% sparser than reality, amplifying the "struggling
exploited tree" silhouette.

This is an aesthetic amplification, not a sim-state lie: the leaf COUNT
(`foliage.leafCount`) is still shown accurately in the BiologyPanel stat; only
the drawn canopy silhouette is scaled. The canopy already tracks the sim state
(low score → over-harvested → low `currentLeaves` → low density); the scale
makes the visual respond slightly more dramatically than the raw leaf count so
the silhouette reads as "stewardship" rather than just "leaf count."

## W52-c — Weather/sky tone var-ification: INVESTIGATED + REJECTED

The W51 review speculated that "the legacy Tailwind weather/cyan accents stay
literal; a follow-up could shift them too." On inspection this turn, shifting
them is **not advisable** — the `sky-*` / weather tones are **semantic**, not
ambient:

- **Focus rings** (`focus:border-sky-500`, `focus-visible:ring-sky-400` on
  every text input in `PurchaseControls`, `TradePanel`, `PolicyConfigurator`,
  etc.) — a focus ring must stay a high-contrast, theme-independent signal. A
  concrete-colored focus ring at the brutalist end would harm keyboard
  accessibility.
- **Water / climate indicators** (`text-sky-800` for Köppen climate codes in
  `ClimatePicker`, biology labels in `BiologyPanel`/`EnvironmentPanel`, the
  `sky` tone variant in `Stat`/`ProgressBar`) — these carry the semantic "this
  is a water/sky-related value" meaning that should not drift with the
  aesthetic tier.
- **Dev-only UI** (`bg-sky-700` buttons in the dev `AnalyticsPanel`) —
  tree-shaken from production; not worth var-ifying.
- **Cosmetic particles** (`particle-bursts.ts` literal hexes — confetti, coins,
  leaf-fall) — intentionally vivid, asset-free cosmetic colors that must not
  shift.

Forcing these to interpolate with the score would break focus-ring visibility,
erase semantic color meaning, and desaturate the cosmetic particle flourishes.
The W51 principle "`accent` (rust) stays a FIXED literal because it is the
error/warning color" extends here: semantic colors stay literal. **Rejected.**
Future W-items should not revisit this without a specific semantic redesign.

## Verification

- **Typecheck:** web clean (`tsc --noEmit`, `noUncheckedIndexedAccess` safe).
- **Tests:** 15 new in `geometry.test.ts` (radius endpoints/midpoint/monotonic/
  clamp/intermediate; canopy scale endpoints/midpoint/monotonic/clamp/
  no-inflation/floor). Full suite **1985/1985 (112 files, 0 failures, 151s)**,
  +15 over W51's 1970. `climate-effect-wiring` 19/19 isolated (single-fork, the
  pre-existing parallel-OOM infra sensitivity, unrelated to W52).
- **Production build:** Next.js green, page **33.7 kB** (+0.2 kB over W51's
  33.5 — the canopy-scale selector + geometry import).
- **Built CSS:** `:root { --ct-radius: 0.125rem }` present; `.rounded-lg {
  border-radius: calc(var(--ct-radius) * 2) }` (and sm/md/xl/DEFAULT) confirmed
  in `.next/static/css/`.
- **Live visual check** (chromium @ 1280×900, `scripts/w52-visual-check.mjs`):
  boot stamps `data-aesthetic="5"` + `--ct-radius: 0.125rem`; computed
  `.rounded-lg` = **0px** (inject `--ct-radius: 0rem`, brutalist) / **4px**
  (neutral@5) / **8px** (inject `0.25rem`, floral = original Tailwind `lg`).
  PIL non-blank ratio 1.000 for all three screenshots.

## Files

| file | role |
|---|---|
| `apps/web/lib/aesthetic/geometry.ts` | `interpolateRadius(score)` + `canopyDensityScale(score)` + endpoints |
| `apps/web/hooks/useAestheticTheme.ts` | writes `--ct-radius` onto `<html>` (with palette + steward + font) |
| `apps/web/app/globals.css` | `:root { --ct-radius: 0.125rem }` (score-5 default, no SSR flash) |
| `apps/web/tailwind.config.mjs` | `borderRadius` remap (multiples of `--ct-radius`; `full`/`none` literal) |
| `apps/web/app/page.tsx` | reads `selectSustainabilityScore` + applies `canopyDensityScale` to `treeRenderData.foliageDensity` |
| `apps/web/test/lib/aesthetic/geometry.test.ts` | 15 tests |
| `scripts/w52-visual-check.mjs` | live 3-tier chromium screenshot + computed-radius harness |

## Follow-ups (future W items)

Remaining from the W51 list (not done this W):

| idea | notes |
|---|---|
| **Tier decorative overlay** | a `data-aesthetic-tier`-keyed `body::after` — diagonal industrial hatch at brutalist, sunlit corner pools at floral. Pure CSS, no var plumbing. |
| **Smokestacks / sun / haze** | the mockup draws smokestacks (score ≤3), a sun (≥7), + pollution haze (≤5) in the tree scene — rendering-package work (canvas-tree-renderer). Larger scope. |
| **Distinctive fonts via `next/font/google`** | self-hosted brutalist/floral faces — adds a build-time network dependency (the current generic stacks are build-network-independent). Defer unless offline-build is relaxed. |
| **Per-tick drift** | a System that gently pulls the score toward the derived ecology so a neglected tree decays toward exploitation even without explicit actions. Sim-layer work. |

New from W52:

| idea | notes |
|---|---|
| **Radius `2xl`/`3xl` unused** | the app uses only `sm`/`md`/`lg`/`xl`/`full`; `2xl`/`3xl` are tree-shaken. If a future panel uses them, they already scale correctly via the remap. |
| **Canopy scale curve** | the linear 0.7→1.0 thins the neutral@5 canopy 15%; a piecewise curve (1.0 for score ≥6, lerp only below) would leave the "good half" untouched. Current linear is fine — revisit if the neutral start reads as too sparse. |
