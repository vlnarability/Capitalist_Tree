// @capitalist-tree/content — content package.
//
// P0 shipped an empty placeholder with subfolder placeholders for each
// content category. P1 populates the species/ subfolder with the White Oak
// (Quercus alba) — the first playable tree species. P2 populates weather/
// (climate baselines, transition matrices, event definitions) and
// fertilizers/ (NPK compositions). P3a populates monetary-policy/ (initial
// issuance policy). P3b populates markets/ (5 commodity market definitions
// for water, fertilizer, seeds, food, energy). Later phases populate the
// remaining categories:
//
//   - species/          : TreeSpecies definitions (GDD §5, TDD §7.7)      [P1]
//   - fertilizers/       : Fertilizer compositions (TDD §8.2)              [P2]
//   - monetary-policy/   : Issuance policy + caps (TDD §10.3, GDD §6.2)    [P3a]
//   - markets/           : Commodity market definitions (GDD §8.5)          [P3b]
//   - equipment/         : Equipment definitions (TDD §12)                [P6b1]
//   - businesses/        : Business type definitions (TDD §5.7/§11, GDD §8) [P8a]
//   - weather/           : Weather event definitions (GDD §4.3, TDD §9)     [P2]
//   - upgrades/          : Upgrade definitions (GDD §11)                    [P6+]
//   - progression/       : Research / genetics / achievement definitions    [P9a]
//                         (GDD §11 Progression & Generations, §12 Objectives)
//
// All content lives here — never hardcoded in engine logic (rule 5).
export * from './species/index.js';
export * from './weather/index.js';
export * from './fertilizers/index.js';
export * from './monetary-policy/index.js';
export * from './markets/index.js';
export * from './equipment/index.js';
export * from './businesses/index.js';
export * from './progression/index.js';
