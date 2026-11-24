/**
 * W52 — non-color aesthetic interpolations driven by the sustainability score
 * (0–10). These complete the dynamic aesthetic shift's visual language beyond
 * color + font (W51): the **corner radius** sharpens toward the brutalist
 * (industrial) end and softens toward the floral (botanical) end, and the
 * **canopy density scale** gently thins the drawn canopy at low stewardship so
 * the silhouette's lushness tracks the score.
 *
 * Both share W51's no-regression invariant: at score 10 (full sustainability)
 * the values reproduce the pre-W52 look EXACTLY — `interpolateRadius(10)` =
 * `0.25rem` (the Tailwind `rounded` DEFAULT base, so every remapped radius
 * token resolves to its original Tailwind value) and `canopyDensityScale(10)` =
 * `1.0` (the drawn canopy = the real leaf-count density, no inflation). The
 * visible shift happens toward the brutalist end (score 0).
 *
 * Like `palette.ts`, these are PURE functions of the integer score — the hook
 * re-writes the `--ct-radius` var only when the score changes (not every tick),
 * and the canopy scale is applied once per render-data memo recomputation.
 */

/**
 * Corner-radius endpoints in rem. Brutalist (score 0) = 0 (sharp industrial
 * corners). Floral (score 10) = 0.25rem — this is Tailwind's `rounded` DEFAULT
 * base (0.25rem = 4px), so when `borderRadius` tokens are remapped as multiples
 * of `--ct-radius` (see tailwind.config.mjs), every token resolves to its
 * original Tailwind value at score 10 (no regression at full sustainability).
 */
export const RADIUS_BRUTALIST = 0; // rem — sharp
export const RADIUS_FLORAL = 0.25; // rem — Tailwind DEFAULT base (= 4px)

/**
 * Canopy-density-scale endpoints. Brutalist (score 0) = 0.7 — the drawn canopy
 * is rendered 30% sparser than the real `currentLeaves / leafCapacity` density
 * (an aesthetic amplification of the "struggling exploited tree" mood). Floral
 * (score 10) = 1.0 — the drawn canopy = the real density (no inflation, no
 * regression). The scale NEVER exceeds 1.0, so the canopy is never drawn fuller
 * than the simulation says it is; it can only be thinned for mood.
 */
export const CANOPY_SCALE_BRUTALIST = 0.7;
export const CANOPY_SCALE_FLORAL = 1.0;

/**
 * Linear interpolation helper (mirrors `lerpTriple`'s clamping discipline).
 * `t` is clamped to [0, 1].
 */
function lerp(a: number, b: number, t: number): number {
  const tc = Math.max(0, Math.min(1, t));
  return a + (b - a) * tc;
}

/**
 * Interpolate the corner radius for a score (0–10) → a CSS length string.
 * Linear from `0rem` (score 0) to `0.25rem` (score 10). The `:root` default in
 * globals.css holds `interpolateRadius(5)` = `0.125rem` so SSR matches the
 * hook's first client write (no flash on hydration).
 */
export function interpolateRadius(score: number): string {
  const rem = lerp(RADIUS_BRUTALIST, RADIUS_FLORAL, score / 10);
  // Round to 4 decimals to avoid float noise (e.g. 0.07500000001rem), then
  // trim trailing zeros so the string is clean for CSS + for snapshot tests.
  const rounded = Math.round(rem * 10000) / 10000;
  return `${rounded}rem`;
}

/**
 * Interpolate the canopy density scale for a score (0–10) → a number in
 * [0.7, 1.0]. Linear from `0.7` (score 0) to `1.0` (score 10). Applied in
 * `page.tsx`'s render-data memo as `foliageDensity * canopyDensityScale(score)`
 * (then re-clamped to [0,1] defensively), so the drawn canopy lushness tracks
 * the stewardship score without ever inflating beyond the real leaf count.
 */
export function canopyDensityScale(score: number): number {
  return lerp(CANOPY_SCALE_BRUTALIST, CANOPY_SCALE_FLORAL, score / 10);
}
