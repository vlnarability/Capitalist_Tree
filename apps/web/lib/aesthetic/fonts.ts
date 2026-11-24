/**
 * W51 — three font tiers driven by the sustainability score. The hook writes
 * `--ct-font-body` (the active stack) + `data-aesthetic-tier` (the tier name)
 * onto `<html>`. `font-serif` in tailwind.config resolves to `var(--ct-font-body)`,
 * so the whole app's serif text migrates with the score.
 *
 * Thresholds match the design mockup: score ≤3 brutalist, ≤6 neutral, >6
 * floral. `font-journal` (the Courier mono "annotation/ledger readout") stays
 * a fixed literal in tailwind.config — deliberately constant for contrast.
 *
 * The floral stack is the existing W48 Georgia-first serif, kept EXACT so the
 * floral end matches the pre-W51 look (no regression at full sustainability).
 */

export type FontTier = 'brutalist' | 'neutral' | 'floral';

export const FONT_STACKS: Record<FontTier, string> = {
  /** Brutalist (score 0–3): industrial monospace — the "extractive ledger" readout. */
  brutalist: '"Courier New", Courier, monospace',
  /** Neutral (score 4–6): clean system sans — the balanced operating state. */
  neutral:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** Floral (score 7–10): the field-journal serif — the naturalist's notebook. */
  floral: 'Georgia, "Times New Roman", "Iowan Old Style", Palatino, serif',
};

/** Tier thresholds (match the design mockup). ≤3 brutalist, ≤6 neutral, >6 floral. */
export function fontTierForScore(score: number): FontTier {
  if (score <= 3) return 'brutalist';
  if (score <= 6) return 'neutral';
  return 'floral';
}

/** A short human label for each tier, for the aesthetic meter. */
export const TIER_LABELS: Record<FontTier, string> = {
  brutalist: 'Exploitation',
  neutral: 'Balanced',
  floral: 'Sustainability',
};
