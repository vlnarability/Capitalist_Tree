/**
 * Eastern Hemlock (Tsuga canadensis) — the second playable tree species (P12-A).
 *
 * WHY HEMLOCK (P12-A / GAP-16)?
 *   - DR-4 (docs/reviews/DECISIONS.md) made height/diameter independence a
 *     prerequisite for a 2nd species; that refactor landed, so P12-A-pre is
 *     satisfied + this species exercises the independent height/diameter
 *     buckets with a CONTRASTING allocation profile vs White Oak.
 *   - P12-A asks for "an evergreen species with contrasting seasonal behavior"
 *     (docs/reviews/MASTER-REVIEW.md §7). Eastern Hemlock is evergreen
 *     (`deciduous: false`) — it keeps its needles + keeps photosynthesizing
 *     through winter, contrasting White Oak's winter dormancy + senescence.
 *     The seasonality logic already branches on `deciduous`
 *     (energy-allocation.ts, photosynthesis.ts), so an evergreen is mostly a
 *     data-driven content addition.
 *
 * CONTRAST WITH WHITE OAK (exercises the data-driven pipeline + DR-4):
 *   - Deciduous (oak) vs evergreen (hemlock) — the seasonal contrast.
 *   - Girth-heavy (oak, heightDiameterSplit 0.4) vs height-focused (hemlock,
 *     0.55) — hemlocks grow proportionally taller for their girth.
 *   - Stout (oak, maxSlendernessRatio 40) vs slender (hemlock, 50).
 *   - Cold-sensitive (oak, temp minimum 5°C) vs cold-tolerant (hemlock, 0°C) —
 *     hemlocks keep photosynthesizing at colder temperatures.
 *   - Slow-maturing canopy species (oak, growthRate 0.5) vs slower-growing
 *     shade-tolerant understory species (hemlock, 0.35).
 *
 * Every constant here is `@provisional` per GDD §17. Tuning belongs in
 * playtesting (P12-C design-promise bot).
 */
import {
  PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,
  type TreeSpecies,
} from '@capitalist-tree/shared';

export const EASTERN_HEMLOCK: TreeSpecies = {
  id: 'species:eastern-hemlock',
  name: 'Eastern Hemlock',
  scientificName: 'Tsuga canadensis',
  deciduous: false,
  // GAP-17 (DR-11): Eastern Hemlock is native to the cool-temperate /
  // boreal transition of eastern North America — Dfb (warm-summer
  // continental) + Dfc (subarctic/taiga margins). Already climate-correct for
  // the default `climate:temperate` (warm-Dfb).
  nativeKoppenCodes: ['Dfb', 'Dfc'],

  // Hemlocks are slow-growing, shade-tolerant understory/conifer species.
  // Slower than oak (0.5). PROVISIONAL: tune against maximumHeight/matureAgeDays.
  growthRate: 0.35,

  // ~250 sim years to reach structural maturity (hemlocks live 250-800 years).
  matureAgeDays: 250 * 120, // 30000 days

  // Real-world eastern hemlocks reach 20-30m. 20m is conservative.
  maximumHeight: 20,
  // Hemlocks are narrower than oaks — a mature hemlock's trunk is ~0.6-0.9m.
  maximumTrunkDiameter: 0.8,
  maximumBranchDevelopment: 80,

  // DR-4: height + diameter grow from INDEPENDENT buckets. Hemlocks are
  // HEIGHT-focused relative to oaks (a taller, more slender silhouette), so
  // height gets 55% of the structural bucket vs the oak's 40%. The remainder
  // (45%) goes to trunk diameter.
  heightDiameterSplit: 0.55,

  // DR-4 allometric constraint. Hemlocks are more slender than oaks — a
  // mature hemlock (20m / 0.8m) has a ratio of 25, so a maxSlendernessRatio of
  // 50 is generous (the clamp only bites for unrealistic sapling shapes).
  maxSlendernessRatio: 50,

  // Root development rate. Slightly slower than oak (0.02) — hemlocks have
  // shallower root systems. PROVISIONAL.
  rootDevelopmentRate: 0.015,

  // Baseline reserve capacity (eu). Lower than oak (1000) — hemlocks are
  // smaller trees with less biomass to draw on.
  reserveCapacity: 800,

  // Daily water demand at full foliage (L/day). Lower than oak (50) —
  // hemlocks are shade-tolerant with lower transpiration.
  waterRequirement: 40,

  nutrientRequirement: {
    nitrogen: 4,
    phosphorus: 1.5,
    potassium: 3,
  },

  temperatureRange: {
    // Hemlocks are cold-tolerant (boreal/temperate) — photosynthesis continues
    // down to 0°C, vs the oak's 5°C minimum. This is part of the evergreen
    // contrast: the hemlock keeps photosynthesizing in cold weather.
    minimum: 0,
    optimum: 18,
    maximum: 32,
  },

  // PROVISIONAL: maximum photosynthesis per leaf area per day at optimum.
  // Slightly lower than oak (1.0) — hemlock needles are less efficient per
  // unit area than oak leaves, but the tree keeps them year-round.
  photosynthesisRate: 0.8,

  // Each needle contributes ~0.002 m² of photosynthetic area — smaller than
  // the oak's broad leaves (0.005). Hemlocks carry many more needles to
  // compensate, but per-needle area is small.
  leafAreaPerLeaf: 0.002,

  // $1.00 per harvested leaf (PROVISIONAL: leaf denomination — same as oak).
  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,

  // Energy cost to regrow one needle (eu). Lower than oak (2) — needles are
  // cheaper to grow than broad leaves. PROVISIONAL.
  leafEnergyCost: 1.5,

  // Max 50% of foliage per harvest action (PROVISIONAL — same as oak).
  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,

  initial: {
    // 40cm sapling — slightly smaller than the oak's 50cm sapling.
    height: 0.4,
    trunkDiameter: 0.008, // 0.8 cm
    branchDevelopment: 0,
    // A young hemlock's canopy: 150 needles of room (smaller than the oak's
    // 200 — hemlocks carry more, smaller needles). The starter 40 needles
    // give it a viable photosynthetic base from day 0.
    leafCapacity: 150,
    // Functional roots — absorptionCapacity=0.25 (slightly lower than oak's
    // 0.3 — hemlocks have shallower roots).
    rootDevelopment: 0.12,
    absorptionCapacity: 0.25,
    // Reserve capacity (eu). 100 eu — slightly lower than the oak's 120.
    reserveCapacity: 100,
    // 40 L internal water buffer (lower than oak's 50).
    waterCapacity: 40,
    // Start fully hydrated.
    waterStored: 40,
    // Starter reserves.
    energyReserves: 100,
    nutrients: {
      nitrogen: 4,
      phosphorus: 1.5,
      potassium: 3,
    },
  },
};
