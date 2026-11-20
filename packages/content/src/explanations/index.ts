/**
 * Explanations content (GAP-35 — GDD §13.3 "Advanced View should explain
 * relationships, not merely display more numbers").
 *
 * Short, relationship-focused explanations for the advanced-view indicators.
 * Each entry pairs an accessible trigger label with a 1-2 sentence explanation
 * of the *relationship* behind the number (per GDD §13.3 — not a definition of
 * the unit, but how the value ties into the simulation's cause + effect).
 *
 * Consumed by the `InfoHint` component next to each advanced-view section header
 * (BiologyPanel today; other advanced panels can adopt the same keys + grow the
 * set here). Content lives in `@capitalist-tree/content` so it stays i18n-able
 * alongside the rest of the table — the text is English for now; translating it
 * is a follow-up once the i18n table (P13-C) covers explanations.
 */
export type ExplanationKey =
  | 'biology-photosynthesis'
  | 'biology-liebig-factors'
  | 'biology-energy-allocation'
  | 'biology-stress'
  | 'biology-sustainable-harvest';

export interface ExplanationEntry {
  /** The stable key (used by `getExplanation` + as a testid stem). */
  readonly key: ExplanationKey;
  /** Accessible label for the InfoHint trigger (e.g. "Explain photosynthesis"). */
  readonly label: string;
  /** 1-2 sentences describing the relationship behind the indicator. */
  readonly text: string;
}

const EXPLANATIONS: Readonly<Record<ExplanationKey, ExplanationEntry>> = {
  'biology-photosynthesis': {
    key: 'biology-photosynthesis',
    label: 'Explain photosynthesis',
    text: 'Photosynthesis converts light, water, and CO₂ into energy (eu/day). The rate is capped by whichever factor is scarcest — Liebig\u2019s law of the minimum — so raising an already-abundant factor will not help until the bottleneck is relieved.',
  },
  'biology-liebig-factors': {
    key: 'biology-liebig-factors',
    label: 'Explain the limiting factors',
    text: 'Each bar is a factor\u2019s potential contribution to photosynthesis (0–100%). The tree\u2019s actual production tracks the lowest one, not the average — the bottleneck sets the rate, and widening it is the only way to raise output.',
  },
  'biology-energy-allocation': {
    key: 'biology-energy-allocation',
    label: 'Explain energy allocation',
    text: 'Energy from photosynthesis is split across growth, maintenance, reproduction, and defense. When production falls short of maintenance, the tree draws on reserves; once reserves are gone, stress rises and health falls.',
  },
  'biology-stress': {
    key: 'biology-stress',
    label: 'Explain tree stress',
    text: 'Stress accumulates from water deficit, temperature extremes, and defoliation. Sustained high stress suppresses photosynthesis and, given enough time, drives mortality — it is the leading indicator of decline.',
  },
  'biology-sustainable-harvest': {
    key: 'biology-sustainable-harvest',
    label: 'Explain the sustainable harvest rate',
    text: 'The recommended rate is the leaf yield the tree can sustain without drawing down reserves or raising stress. Harvesting above it trades short-term income for long-term health; harvesting below it lets the tree recover.',
  },
};

/** The full ordered list of explanation entries (key insertion order). */
export const EXPLANATIONS_LIST: readonly ExplanationEntry[] = (
  Object.keys(EXPLANATIONS) as readonly ExplanationKey[]
).map((k) => EXPLANATIONS[k]);

/** The stable key set (for membership checks). */
export const EXPLANATION_KEYS: readonly ExplanationKey[] = (
  Object.keys(EXPLANATIONS) as readonly ExplanationKey[]
);

/**
 * Look up the explanation entry for a key. Throws for an unknown key (a
 * programming error — the keys are a closed union).
 */
export function getExplanation(key: ExplanationKey): ExplanationEntry {
  const e = EXPLANATIONS[key];
  if (!e) {
    throw new Error(`getExplanation: unknown explanation key "${String(key)}"`);
  }
  return e;
}
