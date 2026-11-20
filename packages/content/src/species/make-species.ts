/**
 * Species-authoring factory (GAP-17 / DR-11 — Phase 2).
 *
 * Each new species is built from its real-world "essence" — max height, growth
 * rate, maturity age, deciduousness, native Köppen band, + temperature response —
 * and the factory derives the rest via allometric scaling + form-based defaults
 * that match the existing hand-tuned White Oak / Eastern Hemlock (e.g. an oak-
 * like broadleaf with maximumHeight 25 reproduces White Oak's reserveCapacity
 * 1000, waterRequirement 50, branchDevelopment 100, nutrients N5/P2/K4). This
 * keeps the 26 new species compact while their constants stay grounded in real
 * biology rather than fabricated tuning.
 *
 * Every derived value is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); the form-based defaults are sensible
 * mid-range values, tunable in playtesting.
 */
import {
  PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,
  PROVISIONAL_DAYS_PER_YEAR,
  type TreeSpecies,
} from '@capitalist-tree/shared';

/** Growth form — drives allometric defaults (trunk slenderness, leaf area, etc.). */
export type SpeciesForm = 'broadleaf' | 'conifer' | 'palm';

/** The species-specific real-world inputs; the factory derives everything else. */
export interface SpeciesEssence {
  id: string;
  name: string;
  scientificName: string;
  deciduous: boolean;
  /** Köppen-Geiger codes this species is native to (non-empty). */
  nativeKoppenCodes: string[];
  /** Maximum structural height (m) — real-world species maximum. */
  maximumHeight: number;
  /** General growth-rate multiplier (dimensionless; oak 0.5, hemlock 0.35). */
  growthRate: number;
  /** Real-world years to structural maturity (× 120 days/year → matureAgeDays). */
  matureAgeYears: number;
  /** Temperature response (°C), derived from the native Köppen climate. */
  temperatureRange: { minimum: number; optimum: number; maximum: number };
  /** Growth form (drives allometric defaults). Defaults from deciduous. */
  form?: SpeciesForm;
  // --- optional species-specific overrides (default = form-based / allometric) ---
  heightDiameterSplit?: number;
  maxSlendernessRatio?: number;
  maximumTrunkDiameter?: number;
  reserveCapacity?: number;
  waterRequirement?: number;
  photosynthesisRate?: number;
  leafAreaPerLeaf?: number;
  leafEnergyCost?: number;
}

/** Per-form allometric + physiological defaults (provisional tuning). */
const FORM_DEFAULTS: Record<SpeciesForm, {
  heightDiameterSplit: number;
  maxSlendernessRatio: number;
  trunkDiameterDivisor: number; // maximumHeight / divisor → maximumTrunkDiameter
  rootDevelopmentRate: number;
  photosynthesisRate: number;
  leafAreaPerLeaf: number;
  leafEnergyCost: number;
  // sapling initial state:
  saplingHeight: number;
  saplingTrunkDiameter: number;
  saplingLeafCapacity: number;
  saplingRootDevelopment: number;
  saplingAbsorption: number;
  saplingReserveCapacity: number;
  saplingWaterCapacity: number;
  saplingEnergyReserves: number;
}> = {
  broadleaf: {
    heightDiameterSplit: 0.4, maxSlendernessRatio: 40, trunkDiameterDivisor: 18,
    rootDevelopmentRate: 0.02, photosynthesisRate: 1.0, leafAreaPerLeaf: 0.005, leafEnergyCost: 2,
    saplingHeight: 0.5, saplingTrunkDiameter: 0.01, saplingLeafCapacity: 200,
    saplingRootDevelopment: 0.15, saplingAbsorption: 0.3, saplingReserveCapacity: 120,
    saplingWaterCapacity: 50, saplingEnergyReserves: 120,
  },
  conifer: {
    heightDiameterSplit: 0.55, maxSlendernessRatio: 50, trunkDiameterDivisor: 30,
    rootDevelopmentRate: 0.015, photosynthesisRate: 0.8, leafAreaPerLeaf: 0.002, leafEnergyCost: 1.5,
    saplingHeight: 0.4, saplingTrunkDiameter: 0.008, saplingLeafCapacity: 150,
    saplingRootDevelopment: 0.12, saplingAbsorption: 0.25, saplingReserveCapacity: 100,
    saplingWaterCapacity: 40, saplingEnergyReserves: 100,
  },
  palm: {
    heightDiameterSplit: 0.7, maxSlendernessRatio: 70, trunkDiameterDivisor: 55,
    rootDevelopmentRate: 0.018, photosynthesisRate: 1.1, leafAreaPerLeaf: 0.008, leafEnergyCost: 3,
    saplingHeight: 0.6, saplingTrunkDiameter: 0.015, saplingLeafCapacity: 80,
    saplingRootDevelopment: 0.1, saplingAbsorption: 0.2, saplingReserveCapacity: 80,
    saplingWaterCapacity: 60, saplingEnergyReserves: 80,
  },
};

const round = (n: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Build a complete TreeSpecies from its real-world essence + allometric defaults. */
export function makeSpecies(e: SpeciesEssence): TreeSpecies {
  const form: SpeciesForm = e.form ?? (e.deciduous ? 'broadleaf' : 'conifer');
  const d = FORM_DEFAULTS[form];
  const maxTrunkDiameter = e.maximumTrunkDiameter ?? round(e.maximumHeight / d.trunkDiameterDivisor, 2);
  // Allometric scaling (matches White Oak at maximumHeight 25 / broadleaf):
  const reserveCapacity = e.reserveCapacity ?? Math.round(e.maximumHeight * 40);
  const waterRequirement = e.waterRequirement ?? Math.round(e.maximumHeight * 2);
  const nutrientRequirement = {
    nitrogen: Math.max(1, Math.round(e.maximumHeight * 0.2)),
    phosphorus: Math.max(0.5, round(e.maximumHeight * 0.08, 1)),
    potassium: Math.max(1, Math.round(e.maximumHeight * 0.16)),
  };
  const saplingReserveCapacity = d.saplingReserveCapacity;
  const saplingWaterCapacity = d.saplingWaterCapacity;
  // Clamp the sapling's starting size so it never exceeds the species' maxima
  // (e.g. a prostrate arctic willow at 0.3 m must not start at the broadleaf
  // default 0.5 m). Sapling is at most 50 % of the species maximum.
  const saplingHeight = Math.min(d.saplingHeight, e.maximumHeight * 0.5);
  const saplingTrunkDiameter = Math.min(d.saplingTrunkDiameter, maxTrunkDiameter * 0.1);
  return {
    id: e.id,
    name: e.name,
    scientificName: e.scientificName,
    deciduous: e.deciduous,
    nativeKoppenCodes: e.nativeKoppenCodes,
    growthRate: e.growthRate,
    matureAgeDays: Math.round(e.matureAgeYears * PROVISIONAL_DAYS_PER_YEAR),
    maximumHeight: e.maximumHeight,
    maximumTrunkDiameter: maxTrunkDiameter,
    maximumBranchDevelopment: Math.round(e.maximumHeight * 4),
    heightDiameterSplit: e.heightDiameterSplit ?? d.heightDiameterSplit,
    maxSlendernessRatio: e.maxSlendernessRatio ?? d.maxSlendernessRatio,
    rootDevelopmentRate: d.rootDevelopmentRate,
    reserveCapacity,
    waterRequirement,
    nutrientRequirement,
    temperatureRange: e.temperatureRange,
    photosynthesisRate: e.photosynthesisRate ?? d.photosynthesisRate,
    leafAreaPerLeaf: e.leafAreaPerLeaf ?? d.leafAreaPerLeaf,
    leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
    leafEnergyCost: e.leafEnergyCost ?? d.leafEnergyCost,
    maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,
    initial: {
      height: saplingHeight,
      trunkDiameter: saplingTrunkDiameter,
      branchDevelopment: 0,
      leafCapacity: d.saplingLeafCapacity,
      rootDevelopment: d.saplingRootDevelopment,
      absorptionCapacity: d.saplingAbsorption,
      reserveCapacity: saplingReserveCapacity,
      waterCapacity: saplingWaterCapacity,
      waterStored: saplingWaterCapacity,
      energyReserves: d.saplingEnergyReserves,
      nutrients: nutrientRequirement,
    },
  };
}
