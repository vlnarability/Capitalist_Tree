/**
 * Genetics pure helpers (P9c — TDD §5.7 / §11, GDD §11.2 Genetic Legacy).
 *
 * GDD §11.2 Genetic Legacy: when establishing new generations, the player
 * preserves genetic material from previous trees. The seven genetic traits
 * (defined as pure content in `packages/content/src/progression/genetics/`)
 * carry forward across the prestige reset, keeping their trait id but
 * re-stamped to the new generation and (optionally) lightly mutated. The
 * original tree's lineage stays identifiable via `genetics.originalLineageId`
 * — a permanent id set once at game start and NEVER modified across resets
 * (GDD §11.2 last sentence).
 *
 *   - `mutateTraitMagnitude(magnitude, rng)` : a small deterministic
 *     perturbation of a trait's expression magnitude (`±
 *     PROVISIONAL_TRAIT_MUTATION_DELTA`), clamped to [0, 1]. The rng is
 *     caller-supplied so the helper is pure + testable; `inheritTraits`
 *     derives an INDEPENDENT seeded rng per carried trait (NOT a fork of the
 *     root RNG — see R-P9-1 below) so prestige-reset stays deterministic
 *     without perturbing the BiologySystem / AutomationSystem mortality
 *     sequences.
 *   - `inheritTraits(state, newGeneration)` : carry the lineage's acquired
 *     traits into the new generation. Every entry on
 *     `genetics.activeTraits` (whether `active: true` or held in reserve
 *     with `active: false`) carries forward — genetic material is preserved
 *     across the lineage (GDD §11.2). Each carried trait keeps its `traitId`
 *     + `active` flag, is re-stamped to `generation: newGeneration` (the
 *     generation now carrying the trait), and its `magnitude` is lightly
 *     mutated. Returns a new `GeneticsState` (activeTraits inherited;
 *     `availableTraits` + `originalLineageId` preserved verbatim).
 *   - `getActiveTraitEffects(state)` : a map of `traitId → { benefit,
 *     tradeOff, magnitude }` for every trait the lineage is currently
 *     EXPRESSING (`active: true`). Deactivated traits are excluded — the
 *     player toggled them off, so neither their benefit nor their trade-off
 *     applies. Used by `trait-effects.ts` (and, in a future task, the
 *     BiologySystem) to apply trait effects to biology parameters.
 *
 * R-P9-1 (RNG fork deferred — matches the R-P7-1 / R-P8-1 precedent): the
 * ProgressionSystem at slot #11 does NOT fork the root RNG every tick
 * because the persisted `rngState` accumulates every per-step fork, which
 * would shift the BiologySystem (#3) + AutomationSystem (#9) child seeds at
 * every subsequent tick and break the calibrated mortality / catch-up death
 * sequences. The prestige-reset, however, is a rare discrete player ACTION
 * (not a per-tick system call), so forking the root RNG ONCE per generation
 * would technically be safe. But to keep the prestige-reset's RNG footprint
 * provably zero (no risk of perturbing any downstream sequence, no test
 * breakage), `inheritTraits` derives an INDEPENDENT seeded RNG per carried
 * trait from a deterministic hash of `(originalLineageId, newGeneration,
 * traitId)` — this consumes ZERO root RNG draws. The lineage's RNG
 * determinism contract (same seed → same mutations) is preserved because the
 * hash inputs are all on the save.
 *
 * Pure: every helper returns a new value without mutating the input.
 * Deterministic given (state, newGeneration) — the mutation is a pure
 * function of `(originalLineageId, newGeneration, traitId, magnitude)`.
 */
import type { GameState, GeneticsState, GeneticTraitState } from '@capitalist-tree/shared';
import { getTraitById } from '@capitalist-tree/content';
import { Rng } from '../rng.js';

// ---------------------------------------------------------------------------
// Local @provisional constants (GDD §17 — genetic modification balance)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.2)
//
// The magnitude of the optional per-generation mutation applied to each
// carried trait's expression strength. The mutation perturbs the magnitude
// by ± this delta (clamped to [0, 1]) — a small drift that rewards lineage
// continuity without ever erasing a trait's expression. PROVISIONAL — tuned
// during playtesting. 0.05 = ±5% per generation.
const PROVISIONAL_TRAIT_MUTATION_DELTA = 0.05;

// ---------------------------------------------------------------------------
// Deterministic string → uint32 seed (FNV-1a)
// ---------------------------------------------------------------------------

/**
 * Hash a string into a non-zero uint32 seed for `Rng.fromSeed`. Used to
 * derive an INDEPENDENT seeded RNG per carried trait from
 * `(originalLineageId, newGeneration, traitId)` WITHOUT touching the root
 * RNG (R-P9-1 — prestige-reset consumes zero root RNG draws). FNV-1a is a
 * simple, well-distributed non-cryptographic hash; the result is masked to
 * 32 bits and forced non-zero (`Rng.fromSeed(0)` would still work but a
 * non-zero seed avoids the degenerate all-zero state).
 *
 * Pure: deterministic given the input string.
 */
function hashStringToSeed(str: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV-1a prime
  }
  return (h >>> 0) || 1; // never 0
}

// ---------------------------------------------------------------------------
// mutateTraitMagnitude
// ---------------------------------------------------------------------------

/**
 * Apply a small mutation to a trait's expression magnitude (GDD §11.2 —
 * genetic material drifts slightly across generations). The mutation
 * perturbs `magnitude` by `± PROVISIONAL_TRAIT_MUTATION_DELTA` (uniform in
 * `[-delta, +delta]`), then clamps the result to [0, 1].
 *
 * The `rng` is caller-supplied so the helper is pure + testable:
 *   - `inheritTraits` derives an INDEPENDENT seeded rng per carried trait
 *     (NOT a root fork — R-P9-1) so prestige-reset consumes zero root RNG
 *     draws.
 *   - Tests pass `Rng.fromSeed(n)` for a deterministic, repeatable
 *     mutation.
 *
 * A magnitude of 0 stays in [0, 2*delta] (it can only drift up — a dormant
 * trait cannot go negative); a magnitude of 1 stays in [1 - 2*delta, 1].
 *
 * Pure: returns a number in [0, 1]. Deterministic given (magnitude, rng).
 */
export function mutateTraitMagnitude(magnitude: number, rng: Rng): number {
  const delta = PROVISIONAL_TRAIT_MUTATION_DELTA;
  // rng.next() ∈ [0, 1) → centered in [-1, 1) → scaled by delta.
  const perturbation = (rng.next() * 2 - 1) * delta;
  return Math.max(0, Math.min(1, magnitude + perturbation));
}

// ---------------------------------------------------------------------------
// inheritTraits
// ---------------------------------------------------------------------------

/**
 * Carry the lineage's acquired genetic traits into a new generation (GDD
 * §11.2 Genetic Legacy — genetic material is preserved across generations).
 *
 * Every entry on `state.progression.genetics.activeTraits` carries forward —
 * whether the trait is currently being expressed (`active: true`) or held in
 * reserve (`active: false`). Genetic material is preserved across the
 * lineage (GDD §11.2); only a trait's EXPRESSION is toggleable, not its
 * acquisition. For each carried trait:
 *
 *   - `traitId` is preserved (the genetic modification is the same one).
 *   - `active` is preserved (a trait expressed in the previous generation
 *     stays expressed; one held in reserve stays in reserve).
 *   - `generation` is re-stamped to `newGeneration` (the generation now
 *     carrying the trait — the lineage's genetic material moves forward with
 *     each generation). The original lineage's permanent identity is tracked
 *     separately on `genetics.originalLineageId` (preserved verbatim below).
 *   - `magnitude` is lightly mutated via `mutateTraitMagnitude` using an
 *     INDEPENDENT seeded rng derived from `(originalLineageId, newGeneration,
 *     traitId)` — zero root RNG draws (R-P9-1).
 *
 * `availableTraits` (trait ids unlocked via research but not yet acquired)
 * and `originalLineageId` (the permanent lineage id — GDD §11.2) are
 * preserved verbatim: the lineage's unlocked genetic potential and its
 * permanent identity both survive the reset.
 *
 * Returns a new `GeneticsState` with the inherited `activeTraits`. Pure:
 * never mutates the input. Deterministic given (state, newGeneration).
 */
export function inheritTraits(
  state: GameState,
  newGeneration: number,
): GeneticsState {
  const genetics = state.progression.genetics;
  const lineageId = genetics.originalLineageId;

  const inheritedActiveTraits: GeneticTraitState[] = genetics.activeTraits.map(
    (trait) => {
      // Derive an INDEPENDENT seeded rng per carried trait — NOT a root fork.
      // The hash inputs are all on the save (lineage id + generation + trait
      // id), so the mutation is deterministic given the save and consumes
      // zero root RNG draws (R-P9-1).
      const seed = hashStringToSeed(`${lineageId}:${newGeneration}:${trait.traitId}`);
      const rng = Rng.fromSeed(seed);
      const mutatedMagnitude = mutateTraitMagnitude(trait.magnitude, rng);
      return {
        traitId: trait.traitId,
        active: trait.active,
        generation: newGeneration,
        magnitude: mutatedMagnitude,
      };
    },
  );

  return {
    activeTraits: inheritedActiveTraits,
    availableTraits: [...genetics.availableTraits],
    // originalLineageId preserved verbatim (NEVER modified — GDD §11.2).
    originalLineageId: genetics.originalLineageId,
  };
}

// ---------------------------------------------------------------------------
// getActiveTraitEffects
// ---------------------------------------------------------------------------

/**
 * The shape of a single trait's effect on the lineage — the benefit + the
 * trade-off (human-readable, from the GeneticTraitDefinition) and the
 * magnitude at which the trait is currently expressed (0–1). Returned by
 * `getActiveTraitEffects` for each trait the lineage is expressing.
 */
export interface TraitEffectInfo {
  /** The trait's benefit (human-readable, from the definition). */
  readonly benefit: string;
  /** The trait's trade-off (human-readable, from the definition). */
  readonly tradeOff: string;
  /** How strongly the trait is expressed, 0–1 (from the trait state). */
  readonly magnitude: number;
}

/**
 * A map of `traitId → { benefit, tradeOff, magnitude }` for every trait the
 * lineage is currently EXPRESSING (`active: true`). Deactivated traits are
 * excluded — the player toggled them off (GDD §11.2 modifications have
 * trade-offs; the player drops both the benefit and the trade-off when a
 * trait is deactivated).
 *
 * The `benefit` / `tradeOff` come from the trait's content definition
 * (`getTraitById`); the `magnitude` comes from the trait state. Unknown
 * trait ids (defensive — content may add traits after a save was written, or
 * a save may carry a stale id) are skipped: the lineage cannot express a
 * trait whose definition is no longer registered.
 *
 * Used by `trait-effects.ts` to apply trait effects to biology parameters
 * (and, in a future task R-P9-N, by the BiologySystem to wire those
 * multipliers into the per-tick biology computation). Pure read.
 */
export function getActiveTraitEffects(
  state: GameState,
): Record<string, TraitEffectInfo> {
  const result: Record<string, TraitEffectInfo> = {};
  for (const trait of state.progression.genetics.activeTraits) {
    if (!trait.active) continue;
    const definition = getTraitById(trait.traitId);
    if (!definition) continue; // unknown id — skip defensively.
    result[trait.traitId] = {
      benefit: definition.benefit,
      tradeOff: definition.tradeOff,
      magnitude: trait.magnitude,
    };
  }
  return result;
}
