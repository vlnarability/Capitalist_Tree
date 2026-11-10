/**
 * Weather module — public surface (P2 — TDD §9).
 *
 * All weather logic is split across pure functions in this directory. The
 * WeatherSystem (systems/weather-system.ts) is the only writer to
 * `state.world.weather`; the pure functions take the current weather +
 * context and return deltas or new values that the system applies.
 *
 * P3+ consumes the `weather-damage` event payload (currently emitted but
 * not yet consumed by P1's BiologySystem — see R-P2-2 in
 * docs/resources-weather.md). P4's renderer reads `state.world.weather`
 * to display the current condition.
 */
export * from './types.js';
export * from './markov.js';
export * from './effects.js';
