/**
 * Audio content registry (W68 — audio variety).
 *
 * Mirrors the equipment/fertilizer registry pattern: each sound is a pure data
 * object (`SoundDefinition`); consumers look up via `getSoundById`. The
 * `play-sound` SimulationEvent carries a `soundId`; the UI's AudioPlayer
 * resolves it through this registry before playing.
 *
 * W68 ships 1 ambient + 3 SFX (no weather/harvest/seasonal — deferred). Add
 * new sounds by appending to `sounds.ts` + exporting below.
 *
 * PROVISIONAL per GDD §17 (audio asset + volume balance).
 */

/** The kind of sound — ambient loops in the background; SFX are one-shot. */
export type SoundKind = 'ambient' | 'sfx';

/** A purchasable/usable sound definition (static content data). */
export interface SoundDefinition {
  /** Canonical sound id, e.g. `'ambient:forest'`, `'sfx:purchase'`. */
  readonly id: string;
  /** Sound kind — ambient (looped background) or sfx (one-shot). */
  readonly kind: SoundKind;
  /** Display name (UI / audio settings). */
  readonly name: string;
  /** Asset path (placeholder — the real files land with P4d / asset pipeline). */
  readonly asset: string;
  /** Whether the sound loops (ambient) or plays once (sfx). */
  readonly loop: boolean;
  /** Default volume ∈ [0, 1]. */
  readonly volume: number;
}

import {
  FOREST_AMBIENT,
  PURCHASE_SFX,
  NOTIFY_SFX,
  ERROR_SFX,
} from './sounds.js';

export {
  FOREST_AMBIENT,
  PURCHASE_SFX,
  NOTIFY_SFX,
  ERROR_SFX,
} from './sounds.js';

/** All known sounds, flat. Add new sounds here + export above. */
export const SOUNDS: readonly SoundDefinition[] = Object.freeze([
  FOREST_AMBIENT,
  PURCHASE_SFX,
  NOTIFY_SFX,
  ERROR_SFX,
]);

/**
 * Thrown when `getSoundById` is asked for an unknown sound id. Mirrors the
 * `UnknownEquipmentError` / `UnknownToolError` pattern.
 */
export class UnknownSoundError extends Error {
  constructor(soundId: string) {
    super(
      `Unknown sound id "${soundId}". Known sounds: ${SOUNDS.map((s) => s.id).join(', ')}.`,
    );
    this.name = 'UnknownSoundError';
  }
}

/** Canonical sound lookup. Returns the `SoundDefinition` or throws. */
export function getSoundById(soundId: string): SoundDefinition {
  const sound = SOUNDS.find((s) => s.id === soundId);
  if (!sound) throw new UnknownSoundError(soundId);
  return sound;
}
