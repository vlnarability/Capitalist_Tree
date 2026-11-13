/**
 * Progression module — public surface (P9b — TDD §5.7 / §11, GDD §11 Progression
 * and Generations, §12 Player Objectives).
 *
 * All progression logic lives here:
 *   - `errors.ts`:       typed errors thrown by the progression action
 *     handlers (UnknownResearchNodeError / ResearchPrerequisitesNotMetError /
 *     InsufficientGeneticLegacyError / UnknownTraitError /
 *     TraitNotAcquiredError / GenerationTooEarlyError). Mirrors the
 *     business/automation/economy error pattern — runtime-only signals, NOT
 *     part of the saved GameState.
 *   - `research.ts`:     pure helpers for research-node unlocking
 *     (`unlockResearchNode`, `getUnlockedResearch`, `isResearchUnlocked`,
 *     `ensureResearchNodeRecord`, `effectiveResearchCost`,
 *     `researchNodeTier`). The `unlock-research` action handler delegates
 *     here.
 *   - `achievements.ts`: pure helpers for achievement evaluation
 *     (`checkAchievements`, `seedTrackedAchievements`,
 *     `shouldCheckAchievements`, `evaluateAchievementProgress`). The
 *     ProgressionSystem (slot #11) calls `checkAchievements` on the throttled
 *     cadence.
 *   - `prestige.ts`:     pure helpers for prestige computation + reset
 *     (`computePrestigeEarned`, `applyPrestigeReset`,
 *     `computeGenerationStart`, `generationDurationStatus`). The
 *     `prestige-reset` action handler delegates here.
 *   - `actions.ts`:     the five progression action handlers
 *     (unlock-research / activate-trait / deactivate-trait / prestige-reset /
 *     record-historical-event).
 *
 * The ProgressionSystem
 * (`packages/simulation/src/systems/progression.ts`) is the only system that
 * touches `state.progression` for tick-driven updates (achievement checks);
 * the pure functions take state + params and return new state + events.
 *
 * Tests import these directly (`packages/simulation/test/progression.test.ts`)
 * to assert the invariants the GDD and TDD require:
 *   - Research: prerequisites gate; cost gate (insufficient points rejects);
 *     cost deducted + totalSpent incremented; node flipped to unlocked;
 *     getUnlockedResearch / isResearchUnlocked correct.
 *   - Achievements: criteria evaluated (wealth / restoration / industrial /
 *     generational / milestones); throttled by interval; emits
 *     achievement-unlocked; doesn't re-unlock already-unlocked.
 *   - Prestige: computePrestigeEarned = (base + traits*mult) * multiplier;
 *     applyPrestigeReset increments generation, records history, adds earned
 *     to balance, preserves originalLineageId.
 *   - Actions: unlock-research (success + fail paths); activate-trait
 *     (available→active); deactivate-trait (active→available flag);
 *     prestige-reset (skeleton); record-historical-event (idempotent).
 *   - originalLineageId never modified by any action.
 *   - Determinism: same seed → same progression state.
 *   - Purity: input not mutated (freeze test).
 */
export * from './errors.js';
export * from './research.js';
export * from './achievements.js';
export * from './prestige.js';
export * from './actions.js';
