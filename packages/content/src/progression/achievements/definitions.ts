/**
 * Achievement definitions — pure data (P9a — TDD §5.7 / §11, GDD §12 Player
 * Objectives).
 *
 * Six objective achievements tied to GDD §12's six player objectives (tracked
 * independently, may overlap — GDD §12 last paragraph), plus six incremental
 * `milestone` achievements (first-business, first-million, first-generation,
 * 1000-days-survived, first-trait, research-pioneer).
 *
 * `completionCriteria` is a human-readable description of what satisfies the
 * achievement — the ProgressionSystem (P9b) evaluates it against live state
 * (cash, biodiversity, forestCoverage, generation count, business ownership,
 * etc.). Keeping the criteria descriptive here keeps the content pure-data
 * (rule 5); the evaluation logic lives in the system, not in the content.
 *
 * PROVISIONAL per GDD §17 (achievement thresholds). The concrete thresholds
 * the ProgressionSystem compares against are provisional tuning values.
 */
import type { AchievementDefinition } from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// GDD §12 objective achievements (the six player objectives).
// ---------------------------------------------------------------------------

export const WEALTHIEST_BEING: AchievementDefinition = {
  id: 'achievement:wealthiest-being',
  name: 'The Wealthiest Being',
  description:
    'Accumulate extraordinary wealth and control a significant portion of ' +
    'the global economy (GDD §12).',
  objectiveCategory: 'wealth',
  completionCriteria:
    'player.personalCash >= PROVISIONAL_ACHIEVEMENT_WEALTH_THRESHOLD AND ' +
    'player controls >= 25% of total monetary supply across all accounts.',
};

export const GREAT_RESTORATION: AchievementDefinition = {
  id: 'achievement:great-restoration',
  name: 'The Great Restoration',
  description:
    'Restore biodiversity, forests, soil, and ecosystem resilience (GDD §12).',
  objectiveCategory: 'restoration',
  completionCriteria:
    'world.environment.biodiversity.index > 0.8 AND ' +
    'world.environment.forestCoverage > 0.8 AND ' +
    'world.environment.soil.health > 0.8 AND ' +
    'world.environment.ecosystemResilience > 0.8.',
};

export const LAST_TREE: AchievementDefinition = {
  id: 'achievement:last-tree',
  name: 'The Last Tree',
  description:
    'Pursue complete environmental destruction and maximize extraction ' +
    '(GDD §12).',
  objectiveCategory: 'destruction',
  completionCriteria:
    'world.environment.biodiversity.index < 0.2 AND ' +
    'world.environment.forestCoverage < 0.1 AND ' +
    'world.environment.landUse.degraded > 0.8 AND ' +
    'cumulative extraction (water + minerals + timber) exceeds PROVISIONAL ' +
    'extraction threshold.',
};

export const NATURAL_BALANCE: AchievementDefinition = {
  id: 'achievement:natural-balance',
  name: 'The Natural Balance',
  description:
    'Maintain the original tree, achieve financial independence, and ' +
    'establish a self-sustaining ecosystem (GDD §12).',
  objectiveCategory: 'balance',
  completionCriteria:
    'originalTree.alive === true AND player.financialSecurity > 0.8 AND ' +
    'ecosystem self-sustaining (net biodiversity + forestCoverage stable or ' +
    'rising across a full sim year with no player intervention).',
};

export const INDUSTRIAL_EMPIRE: AchievementDefinition = {
  id: 'achievement:industrial-empire',
  name: 'The Industrial Empire',
  description:
    'Own the major levels of global supply chains (GDD §12, GDD §8.2).',
  objectiveCategory: 'industrial',
  completionCriteria:
    'player owns at least one business at each of the six supply-chain levels ' +
    '(extraction, processing, manufacturing, distribution, retail, ' +
    'application) AND total business valuation exceeds PROVISIONAL empire ' +
    'threshold.',
};

export const GENERATIONAL_LEGACY: AchievementDefinition = {
  id: 'achievement:generational-legacy',
  name: 'The Generational Legacy',
  description:
    'Develop a successful genetic lineage across multiple generations ' +
    '(GDD §12, GDD §11.3).',
  objectiveCategory: 'generational',
  completionCriteria:
    'progression.prestige.totalGenerations >= PROVISIONAL_ACHIEVEMENT_GENERATIONS_THRESHOLD ' +
    'AND at least one genetic trait carried forward across each generation ' +
    'boundary.',
};

// ---------------------------------------------------------------------------
// Milestone achievements (incremental progress markers).
// ---------------------------------------------------------------------------

export const FIRST_BUSINESS: AchievementDefinition = {
  id: 'achievement:first-business',
  name: 'First Business',
  description:
    'Purchase your first business (GDD §8.1).',
  objectiveCategory: 'milestone',
  completionCriteria: 'state.businesses.length >= 1 for the first time.',
};

export const FIRST_MILLION: AchievementDefinition = {
  id: 'achievement:first-million',
  name: 'First Million',
  description:
    'Accumulate 1,000,000 minor currency units ($10,000) in personal cash.',
  objectiveCategory: 'milestone',
  completionCriteria: 'player.personalCash >= 1000000 (minor units) for the first time.',
};

export const FIRST_GENERATION: AchievementDefinition = {
  id: 'achievement:first-generation',
  name: 'First Generation',
  description:
    'Establish your first new generation via prestige reset (GDD §11.3).',
  objectiveCategory: 'milestone',
  completionCriteria: 'progression.prestige.totalGenerations >= 1 for the first time.',
};

export const THOUSAND_DAYS_SURVIVED: AchievementDefinition = {
  id: 'achievement:1000-days-survived',
  name: '1000 Days Survived',
  description:
    'Keep the original tree alive for 1000 simulation days (GDD §16.1).',
  objectiveCategory: 'milestone',
  completionCriteria:
    'originalTree.alive === true AND clock.day >= 1000.',
};

export const FIRST_TRAIT: AchievementDefinition = {
  id: 'achievement:first-trait',
  name: 'First Trait',
  description:
    'Acquire your first genetic trait (GDD §11.2).',
  objectiveCategory: 'milestone',
  completionCriteria:
    'progression.genetics.activeTraits.length >= 1 for the first time.',
};

export const RESEARCH_PIONEER: AchievementDefinition = {
  id: 'achievement:research-pioneer',
  name: 'Research Pioneer',
  description:
    'Unlock your first research node (GDD §11.2).',
  objectiveCategory: 'milestone',
  completionCriteria:
    'progression.research.nodes.filter(n => n.unlocked).length >= 1 for the first time.',
};

// ---------------------------------------------------------------------------
// Per-bucket arrays + flat union.
// ---------------------------------------------------------------------------

/**
 * The six GDD §12 objective achievements (wealth, restoration, destruction,
 * balance, industrial, generational). Tracked independently and may overlap
 * (GDD §12).
 */
export const OBJECTIVE_ACHIEVEMENTS: readonly AchievementDefinition[] = [
  WEALTHIEST_BEING,
  GREAT_RESTORATION,
  LAST_TREE,
  NATURAL_BALANCE,
  INDUSTRIAL_EMPIRE,
  GENERATIONAL_LEGACY,
];

/**
 * Incremental milestone achievements (first-business, first-million,
 * first-generation, 1000-days-survived, first-trait, research-pioneer).
 */
export const MILESTONE_ACHIEVEMENTS: readonly AchievementDefinition[] = [
  FIRST_BUSINESS,
  FIRST_MILLION,
  FIRST_GENERATION,
  THOUSAND_DAYS_SURVIVED,
  FIRST_TRAIT,
  RESEARCH_PIONEER,
];

/**
 * All known achievements, flat across buckets. Add new achievements to their
 * bucket array and the corresponding per-bucket list — this union stays in
 * sync with them.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  ...OBJECTIVE_ACHIEVEMENTS,
  ...MILESTONE_ACHIEVEMENTS,
];

/**
 * Look up an achievement definition by id. Returns the definition or
 * `undefined` if unknown. The ProgressionSystem (P9b) uses this to resolve an
 * achievement id when evaluating completion criteria; an unknown id is
 * skipped (defensive — content may add achievements after a save was written).
 */
export function getAchievementById(
  achievementId: string,
): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.id === achievementId);
}
