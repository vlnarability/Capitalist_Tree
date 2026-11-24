/**
 * W51 — dynamic aesthetic palette: brutalist (score 0) → neutral (5) → floral
 * (10). Each var-ified token is interpolated LINEARLY in RGB space between a
 * brutalist endpoint (concrete / steel / yellowed canopy) and a floral
 * endpoint. The floral endpoint is the existing W48 field-journal palette
 * (parchment / ink / leaf / bark / brass) kept EXACT, so at score 10 the app
 * looks identical to the pre-W51 look (no regression at full sustainability).
 *
 * `accent` (the rust error/warning color, used by insufficient-funds /
 * dead-tree / severe-weather text) is deliberately NOT var-ified — it stays a
 * fixed literal so error semantics don't shift with the theme. The steward
 * signal (red → brass → green) is a SEPARATE piecewise var (`--ct-steward`)
 * used only by the aesthetic meter.
 *
 * The `:root` defaults in globals.css hold the score=5 (t=0.5) midpoint values
 * — byte-identical to `interpolatePalette(5)` — so SSR renders identically to
 * the hook's first client write (no theme flash on hydration).
 */

/** The var-ified palette tokens; each maps to a `--ct-<name>` CSS variable. */
export const PALETTE_TOKENS = [
  'parchment',
  'parchment-2',
  'parchment-3',
  'ink',
  'ink-2',
  'ink-soft',
  'leaf',
  'leaf-2',
  'leaf-dark',
  'bark',
  'bark-2',
  'brass',
  'brass-2',
] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];

/**
 * Brutalist endpoint (score 0) — concrete, steel, yellowed canopy, sickly
 * trunk. RGB triples (space-separated, for `rgb(var(--ct-X) / <alpha>)`).
 */
export const BRUTALIST: Record<PaletteToken, string> = {
  // W57: bg stays in the cream range (gray-cream at brutalist -> warm-cream at
  // floral) + text stays dark at BOTH endpoints, so bg + text never converge to
  // the same mid-gray at the score=5 midpoint. Pre-W57 the linear lerp between
  // a dark-bg/light-text endpoint and a light-bg/dark-text endpoint drove
  // text-ink-on-parchment to ~1.29:1 at score 5 (WCAG AA needs 4.5:1). Now the
  // minimum is ~5:1 at every score. The brutalist aesthetic is conveyed through
  // sickly accents (yellowed leaf, dark bark/brass) + sharp corners + the mono
  // font tier, not through a dark bg.
  parchment: '200 192 168', // #c8c0a8 gray-cream (colder/harsher than floral)
  'parchment-2': '180 172 148', // #b4ac94 darker gray-cream panel
  'parchment-3': '160 152 128', // #a09880 even darker nested surface
  ink: '40 32 20', // #282014 very dark primary text
  'ink-2': '75 60 40', // #4b3c28 dark secondary text
  'ink-soft': '85 70 48', // #554630 dark labels (passes 4.5:1 on cream)
  leaf: '138 122 58', // #8a7a3a yellowed/sick canopy
  'leaf-2': '154 138 74', // #9a8a4a yellowed
  'leaf-dark': '106 90 42', // #6a5a2a sickly dark
  bark: '58 40 24', // #3a2818 sickly dark trunk
  'bark-2': '42 24 8', // #2a1808 very dark
  brass: '74 58 26', // #4a3a1a dark bronze
  'brass-2': '58 42 16', // #3a2a10 very dark bronze
};

/**
 * Floral endpoint (score 10) — the existing W48 field-journal palette, kept
 * EXACT so the floral end matches the pre-W51 look (no regression).
 */
export const FLORAL: Record<PaletteToken, string> = {
  parchment: '244 236 216', // #f4ecd8
  'parchment-2': '235 224 196', // #ebe0c4
  'parchment-3': '220 207 176', // #dccfb0
  ink: '58 42 26', // #3a2a1a
  'ink-2': '107 86 64', // #6b5640
  'ink-soft': '95 78 52', // #5f4e34 DARKENED (W57) from #8a7a5a to pass 4.5:1 on cream
  leaf: '90 122 58', // #5a7a3a
  'leaf-2': '122 154 74', // #7a9a4a
  'leaf-dark': '58 90 42', // #3a5a2a
  bark: '107 74 42', // #6b4a2a
  'bark-2': '74 50 24', // #4a3218
  brass: '138 106 42', // #8a6a2a
  'brass-2': '106 74 24', // #6a4a18
};

/**
 * Steward accent endpoints (piecewise, NOT linear): red → brass → green. This
 * is the score-indicator color (meter pips + value), NOT a general UI accent.
 */
export const STEWARD_BRUTALIST = '220 38 38'; // #dc2626 industrial red (score 0)
export const STEWARD_NEUTRAL = '176 133 48'; // #b08530 brass (score 5)
export const STEWARD_FLORAL = '74 124 46'; // #4a7c2e leaf green (score 10)

/** The CSS variable name for a token: `parchment-2` → `--ct-parchment-2`. */
export function cssVarName(token: PaletteToken): string {
  return `--ct-${token}`;
}

/**
 * Channel-wise linear interpolation of two space-separated "R G B" triples.
 * Returns "R G B" (integers, Math.round). Defensive against short triples
 * (treats missing channels as 0) for noUncheckedIndexedAccess safety.
 */
export function lerpTriple(a: string, b: string, t: number): string {
  const pa = a.split(' ').map(Number);
  const pb = b.split(' ').map(Number);
  const ar = pa[0] ?? 0;
  const ag = pa[1] ?? 0;
  const ab = pa[2] ?? 0;
  const br = pb[0] ?? 0;
  const bg = pb[1] ?? 0;
  const bb = pb[2] ?? 0;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `${r} ${g} ${bl}`;
}

/**
 * Interpolate ALL palette vars for a score (0–10). Returns a map of
 * `--ct-<token>` → `"R G B"` to write onto `<html>`.
 */
export function interpolatePalette(score: number): Record<string, string> {
  const t = Math.max(0, Math.min(1, score / 10));
  const out: Record<string, string> = {};
  for (const token of PALETTE_TOKENS) {
    out[cssVarName(token)] = lerpTriple(BRUTALIST[token], FLORAL[token], t);
  }
  return out;
}

/**
 * Piecewise steward accent for a score (0–10): red(0) → brass(5) → green(10).
 * The midpoint (5) is brass, not a muddy brown — the balanced state reads as
 * neutral gold. Returns "R G B".
 */
export function interpolateSteward(score: number): string {
  const s = Math.max(0, Math.min(10, score));
  if (s <= 5) {
    return lerpTriple(STEWARD_BRUTALIST, STEWARD_NEUTRAL, s / 5);
  }
  return lerpTriple(STEWARD_NEUTRAL, STEWARD_FLORAL, (s - 5) / 5);
}
