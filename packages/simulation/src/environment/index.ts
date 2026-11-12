/**
 * Environment module — public surface (P7b — TDD §13 Environment System,
 * §5.5 Environmental State, §9.2 Climate Model, §8.3 soil variables; GDD §10
 * Environment, §28 industrial production, §59–67 sustainability pillars,
 * §170 climate patterns).
 *
 * All environment logic lives here as pure helpers. The EnvironmentSystem
 * (`packages/simulation/src/systems/environment.ts`, registry slot #10) is the
 * only system that drives environmental evolution each tick; it calls these
 * helpers in order:
 *
 *   1. `stepAtmosphere`         — advance GHG + aerosol concentrations.
 *   2. `deriveClimateForcing`   — net radiative forcing from the atmosphere.
 *   3. `stepTemperature`        — nudge globalTemperature toward equilibrium.
 *   4. `stepSeaLevel`           — advance sea level with sustained warming.
 *   5. `stepFreshwater`         — regional freshwater reserve dynamics.
 *   6. `stepSoil`               — soil extension-point dynamics + health nudge.
 *   7. `stepBiodiversity`       — biodiversity index + species populations.
 *
 * The system also derives `forestCoverage` from the originalTree's biology
 * outputs (biomass / maturity — READ ONLY, it does not modify biology) and
 * `ecosystemResilience` from biodiversity + forestCoverage + soil.health.
 *
 * Tests import these directly (`packages/simulation/test/environment.test.ts`)
 * to assert the invariants the GDD + TDD require:
 *   - Atmosphere: emissions ↑ CO2, sequestration ↓ CO2, decay removes excess.
 *   - Climate: forcing derived from GHG; temperature moves with inertia;
 *     sea level rises with warming.
 *   - Water: rainfall adds, evaporation removes, contamination decays.
 *   - Soil: contamination degrades health, organic matter recovers it,
 *     compaction decays.
 *   - Biodiversity: declines with stress, recovers when stress removed,
 *     populations track the index.
 *   - Integration: a full sim tick advances all subsystems; forestCoverage
 *     tracks tree growth; ecosystemResilience derived.
 *   - Determinism: same seed → same env state.
 *   - Purity: input not mutated (freeze test).
 *   - Conservation: emissions/sequestration accounting balances.
 */
export * from './atmosphere.js';
export * from './climate.js';
export * from './water.js';
export * from './soil.js';
export * from './biodiversity.js';
