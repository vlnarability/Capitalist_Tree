/**
 * Tutorial / onboarding content (GAP-33 — first-time player guidance).
 *
 * The GDD has no formal tutorial spec, but a first-prototype under review
 * benefits from a one-time "Getting Started" welcome that frames the core loop
 * in a few sentences. This module holds that content: a title, a short intro,
 * + an ordered list of tips covering the core loop (grow → harvest → manage →
 * scale → pursue an ending). The WelcomePanel surfaces it once on first load
 * (dismiss persists to localStorage); a Help control can re-open it later.
 *
 * Content lives in `@capitalist-tree/content` so it stays i18n-able alongside
 * the rest of the table — the text is English for now; translating it is a
 * follow-up once the i18n table (P13-C) covers tutorial strings. The tips are
 * deliberately relationship-first (GDD §13.3 spirit: explain the loop, not just
 * name the buttons).
 */
export interface TutorialTip {
  /** Short heading for the tip (e.g. "Your tree grows"). */
  readonly heading: string;
  /** 1-2 sentences explaining the beat + how it ties into the loop. */
  readonly body: string;
}

export interface TutorialContent {
  /** Modal title. */
  readonly title: string;
  /** 1-2 sentence intro framing the game. */
  readonly intro: string;
  /** Ordered core-loop tips. */
  readonly tips: readonly TutorialTip[];
}

const TUTORIAL: TutorialContent = {
  title: 'Welcome to The Capitalist Tree',
  intro:
    'You steward a single tree in a living economy. It grows by photosynthesis, earns through its leaves, and shapes the world around it. There is no mandatory ending — pick a direction from the six objectives and play toward it.',
  tips: [
    {
      heading: 'Your tree grows',
      body: 'Photosynthesis converts light, water, and CO₂ into energy. The rate is capped by whichever factor is scarcest (Liebig\u2019s law of the minimum), so the tree grows fastest when its needs are balanced, not when one is maxed.',
    },
    {
      heading: 'Harvest leaves for income',
      body: 'Leaves are the currency. Harvest them to earn, but keep the rate sustainable — harvesting above what the tree can replenish draws down reserves and raises stress, eventually threatening the tree.',
    },
    {
      heading: 'Manage resources + stress',
      body: 'Buy water, fertilizer, and energy to keep the tree healthy. Watch soil health and stress in the Biology panel — sustained stress suppresses photosynthesis and, given time, drives mortality.',
    },
    {
      heading: 'Scale up with businesses + automation',
      body: 'Reinvest income into businesses (across six supply-chain levels) and automation to compound earnings. Toggle the Advanced view to see the formulas + relationships behind every number.',
    },
    {
      heading: 'Pursue an ending',
      body: 'Six long-term objectives — Wealth, Restoration, Last Tree, Natural Balance, Industrial Empire, Generational Legacy — are the endings. Pursue any through play; they overlap, and completing one is a moment, not a game-over.',
    },
  ],
};

/** The full tutorial content (title + intro + ordered tips). */
export function getTutorial(): TutorialContent {
  return TUTORIAL;
}
