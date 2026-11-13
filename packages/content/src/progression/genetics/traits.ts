/**
 * Genetic trait definitions — pure data (P9a — TDD §5.7 / §11, GDD §11.2
 * Genetic Legacy).
 *
 * The seven genetic modifications from GDD §11.2's table, each with a benefit
 * and a meaningful trade-off (GDD §11.2: "Genetic modifications should have
 * meaningful trade-offs"). The ProgressionSystem (P9b) applies the benefit
 * scaled by the trait state's `magnitude` (0–1) and applies the trade-off
 * symmetrically.
 *
 * `availabilityRequirement` is the research node id that unlocks the trait for
 * acquisition (GDD §11.2 — genetic legacy unlocks genetic modifications). The
 * mapping is content-defined here, not hardcoded in the system (rule 5):
 *   - improved-photosynthesis (biology) unlocks the energy-related traits:
 *     rapid-growth, large-foliage, thick-trunk, efficient-photosynthesis.
 *   - drought-resistance-breeding (biology) unlocks deep-roots.
 *   - pest-resistance-breeding (biology) unlocks the resistance family:
 *     pest-resistance, cold-resistance.
 *
 * The original tree's lineage remains identifiable (GDD §11.2 last sentence):
 * a trait acquired in generation 1 belongs to the original lineage, recorded
 * on `GeneticTraitState.generation`.
 *
 * PROVISIONAL per GDD §17 (genetic modification balance). Benefits / trade-offs
 * are described in human-readable form; the ProgressionSystem (P9b) interprets
 * them into concrete multipliers.
 */
import type { GeneticTraitDefinition } from '@capitalist-tree/shared';

export const RAPID_GROWTH: GeneticTraitDefinition = {
  id: 'trait:rapid-growth',
  name: 'Rapid Growth',
  description:
    'The tree develops faster — height, trunk, and branch expansion all ' +
    'accelerate. Acquired via the improved-photosynthesis research line.',
  benefit: '+20% growth rate (height / trunk / branch development).',
  tradeOff: '+30% resource demand (water + nutrients) to fuel the faster growth.',
  category: 'growth',
  availabilityRequirement: 'research:improved-photosynthesis',
};

export const LARGE_FOLIAGE: GeneticTraitDefinition = {
  id: 'trait:large-foliage',
  name: 'Large Foliage',
  description:
    'The tree supports a denser leaf canopy, raising its photosynthetic ' +
    'capacity and harvestable leaf output. Acquired via the ' +
    'improved-photosynthesis research line.',
  benefit: '+25% leaf capacity (higher potential production + harvest yield).',
  tradeOff: '+30% water requirements to keep the larger canopy hydrated.',
  category: 'foliage',
  availabilityRequirement: 'research:improved-photosynthesis',
};

export const DEEP_ROOTS: GeneticTraitDefinition = {
  id: 'trait:deep-roots',
  name: 'Deep Roots',
  description:
    'The root system drives deeper, tapping groundwater during dry spells and ' +
    'anchoring the tree against wind. Acquired via the drought-resistance-' +
    'breeding research line.',
  benefit: '+40% drought resistance (sustains photosynthesis through dry periods).',
  tradeOff: '-15% early-development rate (the tree invests in roots before canopy).',
  category: 'roots',
  availabilityRequirement: 'research:drought-resistance-breeding',
};

export const THICK_TRUNK: GeneticTraitDefinition = {
  id: 'trait:thick-trunk',
  name: 'Thick Trunk',
  description:
    'The trunk lays down denser wood, banking greater energy and water ' +
    'reserves against stress. Acquired via the improved-photosynthesis ' +
    'research line (energy surplus → reserve accumulation).',
  benefit: '+30% energy + water reserve capacity (greater resilience to stress).',
  tradeOff: '-20% structural growth rate (the tree invests in trunk density over height).',
  category: 'trunk',
  availabilityRequirement: 'research:improved-photosynthesis',
};

export const PEST_RESISTANCE: GeneticTraitDefinition = {
  id: 'trait:pest-resistance',
  name: 'Pest Resistance',
  description:
    'Natural pest-deterrent chemistry in the foliage reduces vulnerability to ' +
    'pest outbreaks. Acquired via the pest-resistance-breeding research line.',
  benefit: '-50% pest-outbreak damage vulnerability.',
  tradeOff: '-10% growth rate (defensive chemistry diverts energy from growth).',
  category: 'resistance',
  availabilityRequirement: 'research:pest-resistance-breeding',
};

export const COLD_RESISTANCE: GeneticTraitDefinition = {
  id: 'trait:cold-resistance',
  name: 'Cold Resistance',
  description:
    'Cold-hardy cellular chemistry improves frost survival and winter ' +
    'photosynthesis. Acquired via the pest-resistance-breeding research line ' +
    '(the resistance-breeding family).',
  benefit: '+50% frost survival; +20% winter photosynthesis.',
  tradeOff: '-15% warm-climate performance (the cold-hardy chemistry underperforms in heat).',
  category: 'resistance',
  availabilityRequirement: 'research:pest-resistance-breeding',
};

export const EFFICIENT_PHOTOSYNTHESIS: GeneticTraitDefinition = {
  id: 'trait:efficient-photosynthesis',
  name: 'Efficient Photosynthesis',
  description:
    'The leaf chemistry converts a higher fraction of incident light into ' +
    'energy. Acquired via the improved-photosynthesis research line.',
  benefit: '+25% energy production per unit of active leaf area.',
  tradeOff: '-10% maximum growth ceiling (the efficient chemistry caps peak growth).',
  category: 'photosynthesis',
  availabilityRequirement: 'research:improved-photosynthesis',
};

/**
 * All seven genetic traits from GDD §11.2. Add new traits here and to the
 * `GENETIC_TRAITS` array — the order matches GDD §11.2's table.
 */
export const GENETIC_TRAITS: readonly GeneticTraitDefinition[] = [
  RAPID_GROWTH,
  LARGE_FOLIAGE,
  DEEP_ROOTS,
  THICK_TRUNK,
  PEST_RESISTANCE,
  COLD_RESISTANCE,
  EFFICIENT_PHOTOSYNTHESIS,
];

/**
 * Look up a genetic trait definition by id. Returns the definition or
 * `undefined` if unknown. The `activate-trait` / `deactivate-trait` action
 * handlers (P9b) use this to resolve `traitId`; an unknown id raises
 * `UnknownTraitError`.
 */
export function getTraitById(
  traitId: string,
): GeneticTraitDefinition | undefined {
  return GENETIC_TRAITS.find((t) => t.id === traitId);
}
