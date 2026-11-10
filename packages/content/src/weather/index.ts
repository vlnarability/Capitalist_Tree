/**
 * Weather content registry (P2 — TDD §9, GDD §4.3).
 *
 * Exposes the climate baselines, transition matrices, and event definitions
 * to the simulation engine. The WeatherSystem looks up the active climate +
 * transition matrix per step by id.
 *
 * All content lives here — never hardcoded in engine logic (rule 5). Adding
 * a new climate or weather condition means appending to the relevant arrays
 * in this directory; the engine code stays fixed.
 *
 * PROVISIONAL per GDD §17 ("detailed climate model").
 */
export {
  ALL_WEATHER_EVENTS,
  WEATHER_EVENT_MAP,
  findWeatherEvent,
} from './event-definitions.js';
export { TEMPERATE_CLIMATE, ALL_CLIMATES, findClimateById } from './climate-baselines.js';
export {
  ALL_TRANSITION_MATRICES,
  findTransitionMatrix,
} from './transition-matrices.js';
