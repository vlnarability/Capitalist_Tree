/**
 * Audio event schema (W68 — audio variety: 1 ambient + 3 SFX).
 *
 * `play-sound` is a SimulationEvent emitted by action handlers / systems when
 * a sound should play (e.g. `buy-tool` emits `sfx:purchase`). The future UI
 * (P4d React wrapper) subscribes to SimulationEvents + routes `play-sound` to
 * its AudioPlayer; the headless `HeadlessAudioPlayer` stub (in
 * `packages/simulation/src/audio/`) records calls for tests + SSR.
 *
 * W68 ships 4 sounds (1 ambient + 3 SFX; explicitly NO weather/harvest/seasonal
 * sounds — those are deferred). See `packages/content/src/audio/`.
 */
import { z } from 'zod';

/**
 * `play-sound` event — request that the UI play a sound. The `soundId` MUST
 * match a `SoundDefinition.id` in the audio content registry
 * (`packages/content/src/audio/`).
 */
export const playSoundEventSchema = z.object({
  type: z.literal('play-sound'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Sound id, e.g. `'sfx:purchase'`, `'ambient:forest'`. */
    soundId: z.string().min(1),
  }),
});
export type PlaySoundEvent = z.infer<typeof playSoundEventSchema>;
