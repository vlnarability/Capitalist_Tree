/**
 * Achievements content registry (P9a — TDD §5.7 / §11, GDD §12 Player
 * Objectives).
 *
 * Re-exports the GDD §12 objective + milestone achievement definitions and the
 * `getAchievementById` lookup. Each achievement is a pure-data
 * `AchievementDefinition` (rule 5). Follows the same barrel pattern as
 * `packages/content/src/businesses/index.ts`.
 */
export {
  WEALTHIEST_BEING,
  GREAT_RESTORATION,
  LAST_TREE,
  NATURAL_BALANCE,
  INDUSTRIAL_EMPIRE,
  GENERATIONAL_LEGACY,
  FIRST_BUSINESS,
  FIRST_MILLION,
  FIRST_GENERATION,
  THOUSAND_DAYS_SURVIVED,
  FIRST_TRAIT,
  RESEARCH_PIONEER,
  OBJECTIVE_ACHIEVEMENTS,
  MILESTONE_ACHIEVEMENTS,
  ACHIEVEMENTS,
  getAchievementById,
} from './definitions.js';
