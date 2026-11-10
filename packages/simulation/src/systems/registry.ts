/**
 * SystemRegistry — ordered list of Systems executed once per simulation step.
 *
 * The order is STABLE and part of the determinism contract (TDD §18.3).
 * Do NOT reorder existing entries when adding new systems — append or insert
 * deliberately and document why.
 *
 * The order below mirrors TDD §4.2's table:
 *
 *   1. TimeSystem        — advance the clock first; everyone reads new time.
 *   2. WeatherSystem     — produces weather other systems react to.
 *   3. BiologySystem     — photosynthesis/growth; depends on weather + time.
 *   4. ResourceSystem    — water/nutrients/soil; depends on weather + biology.
 *   5. HarvestSystem     — leaf removal; depends on biology.
 *   6. EconomySystem     — money/transactions; depends on harvest output.
 *   7. PersonalSystem    — expenses/well-being; depends on economy.
 *   8. BusinessSystem    — business operations; depends on economy.
 *   9. AutomationSystem  — automated actions; depends on resources/economy.
 *  10. EnvironmentSystem — aggregates environmental impacts.
 *  11. ProgressionSystem — research/achievements; depends on everything.
 *  12. EventSystem       — scheduled events; runs last so it sees the
 *                          fully-updated state for the step.
 *
 * The scheduler is invoked by the engine AFTER all systems run (it's not a
 * system itself) — see `packages/simulation/src/simulation.ts`.
 */
import type { System } from './system.js';

export class SystemRegistry {
  private readonly systems: System[] = [];

  constructor(systems: readonly System[]) {
    this.systems = [...systems];
  }

  all(): readonly System[] {
    return this.systems;
  }

  ids(): readonly string[] {
    return this.systems.map((s) => s.id);
  }
}
