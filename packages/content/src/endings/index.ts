/**
 * Endings content (GAP-36 — GDD §12 "Player Objectives and Endings").
 *
 * The game has no mandatory ending; the six GDD §12 objectives ARE the endings —
 * each is a self-chosen long-term goal the player pursues through play, tracked
 * independently + may overlap (GDD §12: "The player can pursue several
 * objectives in the same playthrough"). When an objective newly completes, the
 * EndingScreen surfaces it as a celebratory ending moment (the player continues
 * playing afterward — completion is soft, not a game-over).
 *
 * This module holds the presentational content for each ending: a display
 * title, the GDD §12 objective description, + a short epilogue (2-3 sentences
 * of flavor/reflection on the outcome). The completion logic + the
 * `ObjectiveId` type live in `@capitalist-tree/simulation` (events/objectives);
 * the `EndingId` union here is structurally identical (the same six id strings)
 * so an `ObjectiveId` value is assignable to `EndingId` without a mapping step.
 *
 * Content lives here (not in simulation) so it stays i18n-able alongside the
 * rest of `@capitalist-tree/content` — the epilogue text is English for now;
 * translating it is a follow-up once the i18n table (P13-C) covers endings.
 */
export type EndingId =
  | 'wealthiest-being'
  | 'great-restoration'
  | 'last-tree'
  | 'natural-balance'
  | 'industrial-empire'
  | 'generational-legacy';

/** The tone of an ending — drives the modal's colour + framing. */
export type EndingTone =
  | 'triumph'
  | 'restoration'
  | 'desolation'
  | 'balance'
  | 'industry'
  | 'legacy';

export interface EndingContent {
  /** The ending id (matches `ObjectiveId` in simulation). */
  readonly id: EndingId;
  /** Display title (e.g. "The Wealthiest Being"). */
  readonly title: string;
  /** The GDD §12 objective description. */
  readonly objective: string;
  /** A short epilogue (2-3 sentences) reflecting on the outcome. */
  readonly epilogue: string;
  /** The ending's tone — drives the modal's colour + framing. */
  readonly tone: EndingTone;
}

/** The stable ordered list of ending ids (GDD §12). */
export const ENDING_IDS: readonly EndingId[] = [
  'wealthiest-being',
  'great-restoration',
  'last-tree',
  'natural-balance',
  'industrial-empire',
  'generational-legacy',
];

const ENDINGS: Readonly<Record<EndingId, EndingContent>> = {
  'wealthiest-being': {
    id: 'wealthiest-being',
    title: 'The Wealthiest Being',
    objective:
      'Amass extraordinary wealth and exert significant influence over the global economy.',
    epilogue:
      'Your fortune has grown beyond counting, and the levers of the global economy answer to your hand. Markets rise and fall on your decisions; nations borrow at your rates. Whether the world flourishes under that weight is a question for another ending.',
    tone: 'triumph',
  },
  'great-restoration': {
    id: 'great-restoration',
    title: 'The Great Restoration',
    objective:
      'Restore biodiversity, forests, soil, and ecosystem resilience.',
    epilogue:
      'Where the land was stripped bare, forests now stand; where the rivers ran thin, they run clear. Biodiversity climbs past the tipping point and the ecosystem begins to heal itself. You have given the world back more than you took from it.',
    tone: 'restoration',
  },
  'last-tree': {
    id: 'last-tree',
    title: 'The Last Tree Standing',
    objective:
      'Pursue complete environmental destruction and maximize extraction.',
    epilogue:
      'The canopy is gone. What remains of the forest fits in a single frame, and the soil beneath it is exhausted. You extracted everything, and the ledger shows a fortune — but there is nothing left to buy with it.',
    tone: 'desolation',
  },
  'natural-balance': {
    id: 'natural-balance',
    title: 'The Natural Balance',
    objective:
      'Maintain the original tree, achieve financial independence, and establish a self-sustaining ecosystem.',
    epilogue:
      'The original tree still stands, older now, its roots deep in self-sustaining soil. Your income covers your costs without lifting a hand, and the ecosystem around you holds its own. You have built something that could outlast you.',
    tone: 'balance',
  },
  'industrial-empire': {
    id: 'industrial-empire',
    title: 'The Industrial Empire',
    objective: 'Own the major levels of global supply chains.',
    epilogue:
      'From the soil to the shelf, every link in the chain carries your mark. Six levels of supply, all answering to one structure. The machine runs, and you own the machine.',
    tone: 'industry',
  },
  'generational-legacy': {
    id: 'generational-legacy',
    title: 'The Generational Legacy',
    objective: 'Develop a successful genetic lineage across multiple generations.',
    epilogue:
      'The first tree is a memory, but its lineage stretches across three generations of careful succession. Each reset carried forward what mattered — the traits, the lessons, the standing of the forest. You have planted something that will outlive any single life.',
    tone: 'legacy',
  },
};

/** The full ordered list of ending content (GDD §12 order). */
export const ENDINGS_LIST: readonly EndingContent[] = ENDING_IDS.map(
  (id) => ENDINGS[id],
);

/**
 * Look up the content for an ending id. Throws for an unknown id (a programming
 * error — the ids are a closed union); callers pass a validated `ObjectiveId`.
 */
export function getEnding(id: EndingId): EndingContent {
  const e = ENDINGS[id];
  if (!e) {
    throw new Error(`getEnding: unknown ending id "${String(id)}"`);
  }
  return e;
}
