// @capitalist-tree/content — content package.
//
// P0 shipped an empty placeholder with subfolder placeholders for each
// content category. P1 populates the species/ subfolder with the White Oak
// (Quercus alba) — the first playable tree species. P2 populates weather/
// (climate baselines, transition matrices, event definitions) and
// fertilizers/ (NPK compositions). P3a populates monetary-policy/ (initial
// issuance policy). Later phases populate the remaining categories:
//
//   - species/          : TreeSpecies definitions (GDD §5, TDD §7.7)      [P1]
//   - fertilizers/       : Fertilizer compositions (TDD §8.2)              [P2]
//   - monetary-policy/   : Issuance policy + caps (TDD §10.3, GDD §6.2)    [P3a]
//   - equipment/         : Equipment definitions (TDD §12)                [P5]
//   - weather/           : Weather event definitions (GDD §4.3, TDD §9)     [P2]
//   - upgrades/          : Upgrade definitions (GDD §11)                    [P6+]
//
// All content lives here — never hardcoded in engine logic (rule 5).
export * from './species/index.js';
export * from './weather/index.js';
export * from './fertilizers/index.js';
export * from './monetary-policy/index.js';
