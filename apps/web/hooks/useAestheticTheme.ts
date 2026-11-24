'use client';
import { useEffect } from 'react';
import { useGameStore, selectSustainabilityScore } from '../stores/game-store';
import { interpolatePalette, interpolateSteward } from '../lib/aesthetic/palette';
import { FONT_STACKS, fontTierForScore } from '../lib/aesthetic/fonts';
import { interpolateRadius } from '../lib/aesthetic/geometry';

/**
 * W51 — drive the dynamic aesthetic from the sustainability score.
 *
 * Mount once at the page root. Each time the integer score changes, writes the
 * interpolated RGB-triple CSS color vars (brutalist@0 → neutral@5 → floral@10)
 * + the piecewise steward accent (`--ct-steward`: red → brass → green) + the
 * corner-radius var (`--ct-radius`: 0 → 0.25rem, W52) + the font-tier
 * `--ct-font-body` var onto `<html>`, and stamps `data-aesthetic` (0–10) +
 * `data-aesthetic-tier` for any discrete CSS selectors that want tier-level
 * hooks.
 *
 * Server-side + pre-boot (simState null) this is a no-op; the `:root` defaults
 * in globals.css render the neutral@5 starting palette during SSR so there is
 * no theme flash on hydration — the hook's first client write at score 5
 * produces identical values.
 *
 * The score selector returns a primitive integer (null pre-boot), so this
 * component only re-renders when the score actually changes (not every tick).
 */
export function useAestheticTheme(): void {
  const score = useGameStore(selectSustainabilityScore);
  useEffect(() => {
    if (score == null) return; // pre-boot: :root defaults render the neutral palette
    const root = document.documentElement;
    const vars = interpolatePalette(score);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    root.style.setProperty('--ct-steward', interpolateSteward(score));
    // W52 — corner radius: sharp (0) at brutalist → soft (0.25rem) at floral.
    // Tailwind's `borderRadius` tokens are remapped as multiples of this var
    // (see tailwind.config.mjs), so the whole app's corners shift with the score.
    root.style.setProperty('--ct-radius', interpolateRadius(score));
    const tier = fontTierForScore(score);
    root.style.setProperty('--ct-font-body', FONT_STACKS[tier]);
    root.setAttribute('data-aesthetic', String(score));
    root.setAttribute('data-aesthetic-tier', tier);
  }, [score]);
}
