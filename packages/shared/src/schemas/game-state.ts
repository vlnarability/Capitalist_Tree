import { z } from 'zod';
import { gameMetadataSchema } from './metadata.js';
import { simulationClockSchema } from './clock.js';
import { playerStateSchema } from './player.js';
import { treeStateSchema } from './tree.js';
import { worldStateSchema } from './environment.js';
import { economyStateSchema } from './economy.js';
import { businessStateSchema } from './business.js';
import { inventoryStateSchema } from './inventory.js';
import { automationStateSchema } from './automation.js';
import { progressionStateSchema } from './progression.js';
import { historicalStateSchema } from './history.js';
import { rngStateSchema } from './rng.js';
import { schedulerStateSchema } from './scheduler.js';

/**
 * Per-system RNG sub-streams (P2 — TDD §18.3).
 *
 * The root RNG (`GameState.rngState`) is shared — forks derived from it each
 * step are stateless per-step draws. Systems that need their sub-stream's
 * position to advance across save/load (stateful per-system RNG) MUST
 * persist the child's state here.
 *
 * P2 adds `weather` for the WeatherSystem: the Markov chain's RNG position
 * survives save/load so the weather sequence is reproducible given
 * seed + sequence number (TDD §18.3). See `docs/simulation.md` §6 note.
 *
 * Future systems that need persistent sub-streams (e.g. a pest-outbreak
 * RNG in P6+) add fields here.
 */
export const rngStreamsSchema = z.object({
  /** Persisted RNG sub-stream for WeatherSystem. */
  weather: rngStateSchema,
});
export type RngStreams = z.infer<typeof rngStreamsSchema>;

/**
 * Root GameState (TDD §5.1).
 *
 * Fields beyond the TDD's original list:
 *   - `rngState`: serializable RNG position so determinism survives save/load.
 *     This is required by TDD §18.3 (deterministic tests) and the P0 spec.
 *   - `scheduler`: serializable event scheduler (TDD §6.4). Persisted so
 *     scheduled events survive reload.
 *
 * The original tree is explicitly separated from additional trees (TDD §5.1)
 * at the `originalTree` field. The schema superRefine below enforces GDD
 * §16.1/16.2 (cannot be sold/transferred/replaced) by rejecting saves where
 * `originalTree.isOriginal === false` or `originalTree.id !== 'original'`.
 */
export const gameStateSchema = z
  .object({
    metadata: gameMetadataSchema,
    clock: simulationClockSchema,
    player: playerStateSchema,
    originalTree: treeStateSchema,
    world: worldStateSchema,
    economy: economyStateSchema,
    businesses: z.array(businessStateSchema),
    inventory: inventoryStateSchema,
    automation: z.array(automationStateSchema),
    progression: progressionStateSchema,
    history: historicalStateSchema,
    // P0 additions beyond TDD §5.1 (documented in docs/simulation.md):
    rngState: rngStateSchema,
    scheduler: schedulerStateSchema,
    // P2 addition: per-system RNG sub-streams that need to survive save/load
    // (TDD §18.3). Currently only WeatherSystem needs this.
    rngStreams: rngStreamsSchema.default(() => ({ weather: [0, 0, 0, 0] as [number, number, number, number] })),
  })
  .superRefine((s, ctx) => {
    // GDD §16.1: The original tree cannot be sold.
    // GDD §16.2: The original tree cannot be replaced.
    // TDD §18.4: No accidental sale or transfer of the original tree.
    if (s.originalTree.isOriginal !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['originalTree', 'isOriginal'],
        message: 'originalTree.isOriginal MUST be true (GDD §16.1/16.2).',
      });
    }
    if (s.originalTree.id !== 'original') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['originalTree', 'id'],
        message: "originalTree.id MUST be 'original' (GDD §16.1/16.2).",
      });
    }
  });

export type GameState = z.infer<typeof gameStateSchema>;
