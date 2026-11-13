/**
 * Progression content registry (P9a — TDD §5.7 / §11, GDD §11 Progression and
 * Generations, §12 Player Objectives).
 *
 * Aggregates the three progression content sub-registries:
 *   - research/    : ResearchNodeDefinition objects (GDD §11.2 — genetic legacy
 *                    unlocks research).
 *   - genetics/    : GeneticTraitDefinition objects (GDD §11.2 — the seven
 *                    genetic modifications with trade-offs).
 *   - achievements/: AchievementDefinition objects (GDD §12 — the six player
 *                    objectives + milestones).
 *
 * Each is pure data (rule 5). The ProgressionSystem (P9b) reads these
 * definitions to validate progression actions and evaluate achievement
 * completion. Follows the same pattern as `packages/content/src/businesses/`.
 */
export * from './research/index.js';
export * from './genetics/index.js';
export * from './achievements/index.js';
