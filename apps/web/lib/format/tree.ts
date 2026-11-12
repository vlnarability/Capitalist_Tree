/**
 * Tree condition formatting helpers (P5b — GDD §13.1 main screen, §13.2 simplified view).
 *
 * Pure functions that translate the simulation's biological [0, 1] health /
 * stress / density values into the plain-language tiered summaries the
 * simplified dashboard shows (GDD §13.2: "Players should not need to
 * understand photosynthetic efficiency, carbon flux, or nutrient ratios").
 *
 * Three tiers — `Healthy` / `Stressed` / `Critical` — derived from the same
 * thresholds the renderer uses for foliage colour (GDD §13.4, see
 * `PROVISIONAL_RENDER_FOLIAGE_HEALTHY_THRESHOLD` /
 * `PROVISIONAL_RENDER_FOLIAGE_STRESSED_THRESHOLD` in
 * `packages/rendering/src/constants/rendering.ts`). Re-declared locally
 * rather than imported so the UI helper stays free of a rendering dependency
 * (the renderer's constants are presentation-tuning values; the UI's are
 * plain-language thresholds that happen to coincide today but may diverge
 * under playtesting).
 *
 * Output types:
 *   - `ConditionTier` — `'healthy' | 'stressed' | 'critical' | 'dead'`.
 *   - `ConditionLabel` — `{ tier: ConditionTier; label: string; tone: Tone }`
 *     where `tone` is the Tailwind-friendly colour class fragment used by
 *     the dashboard to pick a text color + ProgressBar tint.
 *
 * Rule 6 (rendering / UI reads state, never writes): every function here
 * reads a number, returns a string / enum, and never touches the engine.
 */

/**
 * Coarse condition tier shown on the simplified dashboard. The renderer
 * also derives visual cues from the same `[0, 1]` values but uses its own
 * thresholds (see `packages/rendering/src/constants/rendering.ts`); the UI
 * keeps these independent so playtesting can tune the wording without
 * touching the renderer.
 */
export type ConditionTier = 'healthy' | 'stressed' | 'critical' | 'dead';

/**
 * Tailwind colour-fragment used by the dashboard to pick a text colour +
 * ProgressBar tint for a given tier. Fragments map to Tailwind's
 * `text-{tone}-300` / `bg-{tone}-500/10` / `stroke-{tone}-400` family.
 */
export type Tone = 'emerald' | 'amber' | 'rose' | 'slate';

export interface ConditionLabel {
  readonly tier: ConditionTier;
  /** Plain-language label, e.g. `'Healthy'`, `'Stressed'`. */
  readonly label: string;
  /** Tailwind tone fragment (see {@link Tone}). */
  readonly tone: Tone;
  /**
   * Short, one-line plain-language hint shown under the label. Helps the
   * player understand what the tier means without exposing nutrient ratios
   * or photosynthetic efficiency (GDD §13.2).
   */
  readonly hint: string;
}

// PROVISIONAL (GDD §13.2 + §17: simplified view thresholds).
//
// Thresholds for the `healthy` → `stressed` → `critical` tier transitions on
// the simplified dashboard. They mirror the renderer's
// `PROVISIONAL_RENDER_FOLIAGE_HEALTHY_THRESHOLD = 0.7` /
// `PROVISIONAL_RENDER_FOLIAGE_STRESSED_THRESHOLD = 0.3` so a tree that looks
// stressed on the canvas is also labelled "Stressed" on the dashboard — the
// two presentations stay in sync without coupling the code. Re-declared
// locally so the UI helper has zero rendering-package dependency.
//
// When these are promoted from "provisional" to "decided" via playtesting,
// move them to `apps/web/lib/constants.ts` and drop the `PROVISIONAL_` prefix
// (matching the rendering package's convention).
export const PROVISIONAL_UI_TREE_HEALTHY_THRESHOLD = 0.7;
export const PROVISIONAL_UI_TREE_STRESSED_THRESHOLD = 0.3;

const TIER_LABELS: Readonly<Record<ConditionTier, ConditionLabel>> = Object.freeze({
  healthy: {
    tier: 'healthy',
    label: 'Healthy',
    tone: 'emerald',
    hint: 'The tree is thriving — canopy is full and foliage is untroubled.',
  },
  stressed: {
    tier: 'stressed',
    label: 'Stressed',
    tone: 'amber',
    hint: 'The tree is coping. Watch water, weather, and harvest pressure.',
  },
  critical: {
    tier: 'critical',
    label: 'Critical',
    tone: 'rose',
    hint: 'The tree is failing. Action is needed or it may die.',
  },
  dead: {
    tier: 'dead',
    label: 'Dead',
    tone: 'slate',
    hint: 'This tree has died. The original tree is not lost — your land endures.',
  },
});

/**
 * Map a [0, 1] health factor (1 = fully healthy, 0 = dead) to a
 * {@link ConditionTier}. The function is pure + total:
 *
 *   - `value >= 0.7` → `'healthy'`
 *   - `0.3 ≤ value < 0.7` → `'stressed'`
 *   - `0 < value < 0.3` → `'critical'`
 *   - `value ≤ 0` → `'dead'` (treated as dead; the dashboard uses the
 *     tree's `alive` flag for the authoritative death signal, but this
 *     helper collapses a non-positive health value to `dead` for safety).
 *
 * NaN inputs are treated as `'critical'` — a transient bad value should not
 * crash the dashboard, and the worst-case label is the safest default.
 */
export function tierFromHealth(value: number): ConditionTier {
  if (!Number.isFinite(value)) return 'critical';
  if (value <= 0) return 'dead';
  if (value >= PROVISIONAL_UI_TREE_HEALTHY_THRESHOLD) return 'healthy';
  if (value >= PROVISIONAL_UI_TREE_STRESSED_THRESHOLD) return 'stressed';
  return 'critical';
}

/**
 * Map a [0, 1] stress factor (0 = no stress, 1 = maximum stress) to a
 * {@link ConditionTier}. Stress is the canonical driver for foliage colour
 * in the renderer (`foliageCondition = 1 - stress`) — this helper mirrors
 * that mapping so the dashboard's wording tracks the canopy's colour.
 *
 *   - `stress < (1 - 0.7) = 0.3` → `'healthy'`
 *   - `0.3 ≤ stress < 0.7` → `'stressed'`
 *   - `0.7 ≤ stress < 1` → `'critical'`
 *   - `stress >= 1` → `'dead'`
 */
export function tierFromStress(stress: number): ConditionTier {
  if (!Number.isFinite(stress)) return 'critical';
  return tierFromHealth(1 - stress);
}

/**
 * Resolve a {@link ConditionLabel} for the given tier. Returns the full
 * plain-language summary object (label + tone + hint) so the dashboard can
 * render `<span class="text-{tone}-300">{label}</span>` + a one-line hint
 * below.
 */
export function labelForTier(tier: ConditionTier): ConditionLabel {
  return TIER_LABELS[tier];
}

/**
 * Convenience: derive a {@link ConditionLabel} from the tree's stress +
 * alive flag in one call. Used by `TreeConditionSummary`.
 *
 *   - If `alive === false`, returns the `dead` label regardless of stress.
 *   - Else, derives the tier from `stress` via {@link tierFromStress} and
 *     returns the corresponding label.
 *
 * @param alive — the tree's `alive` flag.
 * @param stress — the tree's `stress` in [0, 1].
 */
export function labelForTree(alive: boolean, stress: number): ConditionLabel {
  if (!alive) return TIER_LABELS.dead;
  return labelForTier(tierFromStress(stress));
}

/**
 * Map a [0, 1] progress value to a `data-progress` segment the dashboard
 * can pass to a `<ProgressBar>`'s `value` prop. Clamps to [0, 1]:
 *
 *   - `NaN` → `0` (defensive — never crash the dashboard).
 *   - `±Infinity` → clamped to the nearer bound (`+Inf → 1`, `-Inf → 0`).
 *
 * Used to feed `tree.health`, `tree.foliage.seasonalCondition`, and
 * `world.environment.soil.health` into the simplified-view ProgressBar.
 */
export function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
