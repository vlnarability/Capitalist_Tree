/**
 * Research node definitions — pure data (P9a — TDD §5.7 / §11, GDD §11.2
 * genetic legacy unlocks research, §11.1 Expansion).
 *
 * The research tree spans the simulation's pillars (GDD §11.1):
 *   - biology    : photosynthesis, drought/pest resistance breeding.
 *   - automation : irrigation, fertilization, harvesting.
 *   - business   : supply chains, markets, corporate structure.
 *   - environment: carbon capture, soil, biodiversity.
 *   - energy     : solar, batteries.
 *
 * Each node is a `ResearchNodeDefinition`. The ProgressionSystem (P9b) reads a
 * definition to validate an `unlock-research` action (prerequisites met +
 * genetic-legacy cost available). `cost` is genetic-legacy points (the prestige
 * currency — GDD §11.2), NOT minor currency units; serialized as bigint
 * string (TDD §10.1 precision discipline).
 *
 * PROVISIONAL per GDD §17 (research tree balance). Costs are tuning values;
 * the `effects.unlocks` ids reference content (equipment / business types /
 * trait ids) the node makes available, and `effects.multiplier` is an optional
 * numeric bonus the ProgressionSystem applies.
 *
 * Rule 5: content is data — never hardcoded in engine logic. Add a node by
 * appending to its category array + to `RESEARCH_NODES`.
 */
import type { ResearchNodeDefinition } from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Biology (GDD §11.1 — biology research unlocks genetic traits).
// ---------------------------------------------------------------------------

export const IMPROVED_PHOTOSYNTHESIS: ResearchNodeDefinition = {
  id: 'research:improved-photosynthesis',
  name: 'Improved Photosynthesis',
  description:
    'Breed for higher photosynthetic efficiency. The foundational biology ' +
    'research — unlocks the energy-related genetic traits (rapid-growth, ' +
    'large-foliage, thick-trunk, efficient-photosynthesis) and raises the ' +
    "tree's baseline energy production.",
  category: 'biology',
  prerequisites: [],
  cost: '10', // 10 genetic-legacy points (PROVISIONAL)
  effects: {
    description:
      '+0.1 baseline photosynthesis efficiency; unlocks rapid-growth, ' +
      'large-foliage, thick-trunk, efficient-photosynthesis traits.',
    unlocks: [
      'trait:rapid-growth',
      'trait:large-foliage',
      'trait:thick-trunk',
      'trait:efficient-photosynthesis',
    ],
    multiplier: 0.1,
  },
};

export const DROUGHT_RESISTANCE_BREEDING: ResearchNodeDefinition = {
  id: 'research:drought-resistance-breeding',
  name: 'Drought-Resistance Breeding',
  description:
    'Select for deeper, wider-reaching root systems that tap groundwater ' +
    'during dry spells. Unlocks the deep-roots trait (GDD §11.2 — drought ' +
    'resistance / slower early development trade-off).',
  category: 'biology',
  prerequisites: ['research:improved-photosynthesis'],
  cost: '15', // 15 genetic-legacy points (PROVISIONAL)
  effects: {
    description: 'Unlocks the deep-roots genetic trait.',
    unlocks: ['trait:deep-roots'],
  },
};

export const PEST_RESISTANCE_BREEDING: ResearchNodeDefinition = {
  id: 'research:pest-resistance-breeding',
  name: 'Pest-Resistance Breeding',
  description:
    'Breed for natural pest deterrence and broader stress tolerance. Unlocks ' +
    'the resistance-family traits (pest-resistance, cold-resistance) per GDD ' +
    '§11.2 (reduced vulnerability / potential growth trade-off; better frost ' +
    'survival / reduced warm-climate performance).',
  category: 'biology',
  prerequisites: ['research:improved-photosynthesis'],
  cost: '20', // 20 genetic-legacy points (PROVISIONAL)
  effects: {
    description: 'Unlocks the pest-resistance and cold-resistance genetic traits.',
    unlocks: ['trait:pest-resistance', 'trait:cold-resistance'],
  },
};

// ---------------------------------------------------------------------------
// Automation (GDD §11.1 — commercial forestry / regional businesses scale via
// automation).
// ---------------------------------------------------------------------------

export const ADVANCED_IRRIGATION: ResearchNodeDefinition = {
  id: 'research:advanced-irrigation',
  name: 'Advanced Irrigation',
  description:
    'Soil-moisture-sensing irrigation that delivers water only where the ' +
    'roots need it. Raises irrigation automation efficiency and reduces ' +
    'water waste.',
  category: 'automation',
  prerequisites: [],
  cost: '12', // 12 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 irrigation automation efficiency; -10% water waste.',
    multiplier: 0.1,
  },
};

export const PRECISION_FERTILIZATION: ResearchNodeDefinition = {
  id: 'research:precision-fertilization',
  name: 'Precision Fertilization',
  description:
    "NPK-tailored fertigation that matches the tree's exact nutrient deficits " +
    'each cycle. Raises fertilization automation efficiency and reduces ' +
    'runoff pollution.',
  category: 'automation',
  prerequisites: ['research:advanced-irrigation'],
  cost: '18', // 18 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 fertilization automation efficiency; -10% runoff pollution.',
    multiplier: 0.1,
  },
};

export const AUTONOMOUS_HARVESTING: ResearchNodeDefinition = {
  id: 'research:autonomous-harvesting',
  name: 'Autonomous Harvesting',
  description:
    "Robotic leaf harvesters that time cuts to the tree's seasonal flush. " +
    'Raises harvest automation efficiency and reduces defoliation stress.',
  category: 'automation',
  prerequisites: ['research:precision-fertilization'],
  cost: '25', // 25 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.15 harvest automation efficiency; -15% defoliation stress.',
    multiplier: 0.15,
  },
};

// ---------------------------------------------------------------------------
// Business (GDD §11.1 — regional businesses / global operations; GDD §8.2
// supply chains, §8.3 economic organizations).
// ---------------------------------------------------------------------------

export const SUPPLY_CHAIN_OPTIMIZATION: ResearchNodeDefinition = {
  id: 'research:supply-chain-optimization',
  name: 'Supply-Chain Optimization',
  description:
    'Logistics research that tightens the links between extraction, ' +
    'processing, manufacturing, distribution, retail, and application (GDD ' +
    '§8.2). Raises business operating efficiency across the chain.',
  category: 'business',
  prerequisites: [],
  cost: '20', // 20 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 business operating efficiency across all supply-chain levels.',
    multiplier: 0.1,
  },
};

export const MARKET_ANALYSIS: ResearchNodeDefinition = {
  id: 'research:market-analysis',
  name: 'Market Analysis',
  description:
    'Demand-forecasting research that lets businesses time their output to ' +
    'peak commodity-market windows (GDD §8.5). Raises market-sale revenue ' +
    'capture.',
  category: 'business',
  prerequisites: ['research:supply-chain-optimization'],
  cost: '15', // 15 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 market-sale revenue capture across all commodity markets.',
    multiplier: 0.1,
  },
};

export const CORPORATE_STRUCTURE: ResearchNodeDefinition = {
  id: 'research:corporate-structure',
  name: 'Corporate Structure',
  description:
    'Organizational research that unlocks the advanced economic-organization ' +
    'forms (corporation, cooperative, sustainable-enterprise, non-profit, ' +
    'state-owned — GDD §8.3) beyond the default sole-proprietorship, and ' +
    'enables multi-business holding companies.',
  category: 'business',
  prerequisites: ['research:market-analysis'],
  cost: '30', // 30 genetic-legacy points (PROVISIONAL)
  effects: {
    description:
      'Unlocks corporation / cooperative / sustainable-enterprise / ' +
      'non-profit / state-owned ownership structures; enables holding ' +
      'companies.',
    unlocks: [
      'ownership:corporation',
      'ownership:cooperative',
      'ownership:sustainable-enterprise',
      'ownership:non-profit',
      'ownership:state-owned',
    ],
  },
};

// ---------------------------------------------------------------------------
// Environment (GDD §11.1 — larger properties / commercial forestry interact
// with the environment; GDD §10 environment model).
// ---------------------------------------------------------------------------

export const CARBON_CAPTURE: ResearchNodeDefinition = {
  id: 'research:carbon-capture',
  name: 'Carbon Capture',
  description:
    'Research into enhanced sequestration — both biological (denser foliage) ' +
    'and technological (direct-air capture equipment). Raises the ' +
    "environment's sequestration rate.",
  category: 'environment',
  prerequisites: [],
  cost: '22', // 22 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 atmosphere sequestration rate; unlocks carbon-capture equipment.',
    unlocks: ['equipment:carbon-capture-unit'],
    multiplier: 0.1,
  },
};

export const SOIL_RESTORATION: ResearchNodeDefinition = {
  id: 'research:soil-restoration',
  name: 'Soil Restoration',
  description:
    'Remediation research that rebuilds organic matter, balances pH, and ' +
    'recolonizes soil microbiota. Raises soil health recovery rate and ' +
    'lowers compaction.',
  category: 'environment',
  prerequisites: [],
  cost: '16', // 16 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 soil health recovery rate; -10% compaction.',
    multiplier: 0.1,
  },
};

export const BIODIVERSITY_ENHANCEMENT: ResearchNodeDefinition = {
  id: 'research:biodiversity-enhancement',
  name: 'Biodiversity Enhancement',
  description:
    'Habitat-restoration research that reintroduces species populations and ' +
    'raises the ecosystem biodiversity index (GDD §10). A prerequisite for ' +
    'the Great Restoration objective (GDD §12).',
  category: 'environment',
  prerequisites: ['research:soil-restoration'],
  cost: '24', // 24 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 biodiversity index recovery; +0.1 ecosystem resilience.',
    multiplier: 0.1,
  },
};

// ---------------------------------------------------------------------------
// Energy (GDD §11.1 — global operations need energy infrastructure; P7a
// energy pool).
// ---------------------------------------------------------------------------

export const SOLAR_EFFICIENCY: ResearchNodeDefinition = {
  id: 'research:solar-efficiency',
  name: 'Solar Efficiency',
  description:
    'Photovoltaic research that raises the generation rate of solar-panel ' +
    'equipment (P6b1) feeding the environment energy pool (P7a).',
  category: 'energy',
  prerequisites: [],
  cost: '14', // 14 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 solar-panel generation rate.',
    multiplier: 0.1,
  },
};

export const BATTERY_TECHNOLOGY: ResearchNodeDefinition = {
  id: 'research:battery-technology',
  name: 'Battery Technology',
  description:
    "Storage research that raises the energy pool's capacity and reduces " +
    'storage losses (P7a energy pool). Lets surplus generation bank ' +
    'through the night.',
  category: 'energy',
  prerequisites: ['research:solar-efficiency'],
  cost: '19', // 19 genetic-legacy points (PROVISIONAL)
  effects: {
    description: '+0.1 energy pool capacity; -10% storage loss.',
    multiplier: 0.1,
  },
};

// ---------------------------------------------------------------------------
// Per-category arrays + flat union.
// ---------------------------------------------------------------------------

export const BIOLOGY_RESEARCH: readonly ResearchNodeDefinition[] = [
  IMPROVED_PHOTOSYNTHESIS,
  DROUGHT_RESISTANCE_BREEDING,
  PEST_RESISTANCE_BREEDING,
];

export const AUTOMATION_RESEARCH: readonly ResearchNodeDefinition[] = [
  ADVANCED_IRRIGATION,
  PRECISION_FERTILIZATION,
  AUTONOMOUS_HARVESTING,
];

export const BUSINESS_RESEARCH: readonly ResearchNodeDefinition[] = [
  SUPPLY_CHAIN_OPTIMIZATION,
  MARKET_ANALYSIS,
  CORPORATE_STRUCTURE,
];

export const ENVIRONMENT_RESEARCH: readonly ResearchNodeDefinition[] = [
  CARBON_CAPTURE,
  SOIL_RESTORATION,
  BIODIVERSITY_ENHANCEMENT,
];

export const ENERGY_RESEARCH: readonly ResearchNodeDefinition[] = [
  SOLAR_EFFICIENCY,
  BATTERY_TECHNOLOGY,
];

/**
 * All known research nodes, flat across categories. Add new nodes to their
 * category array and the corresponding per-category list — this union stays in
 * sync with them.
 */
export const RESEARCH_NODES: readonly ResearchNodeDefinition[] = [
  ...BIOLOGY_RESEARCH,
  ...AUTOMATION_RESEARCH,
  ...BUSINESS_RESEARCH,
  ...ENVIRONMENT_RESEARCH,
  ...ENERGY_RESEARCH,
];
