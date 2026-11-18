/**
 * Organizational-structure incentives (P13-A / GAP-23 — GDD §8.3).
 *
 * Each of the six GDD §8.3 org structures has distinct incentives that modify
 * how the BusinessSystem treats it. P3b/P8a shipped only the corporation
 * shareholder-pressure path; this table generalizes it to all six types via
 * per-type multipliers consumed by:
 *
 *   - `growth-pressure.ts applyShareholderExpectations` — `growthPressureMultiplier`
 *     scales the underperformance valuation penalty (corporation 1.0 = full
 *     shareholder pressure; non-profit 0.0 = no profit pressure; cooperative
 *     0.3 = member pressure is gentler).
 *   - `valuation.ts` — `valuationMultiplier` scales the business's computed
 *     valuation (corporation 1.2 = liquidity premium; non-profit 0.75 = no
 *     profit-driven multiple).
 *   - `impact.ts` / production — `environmentalImpactMultiplier` scales the
 *     business's environmental impact (sustainable-enterprise 0.5 = half the
 *     footprint; others 1.0).
 *
 * Pure data — the simulation reads it via `getOrgTypeIncentives(structure)`.
 * Adding a new structure = append a row + widen the schema enum.
 */
import type { OwnershipState } from '@capitalist-tree/shared';

export interface OrgTypeIncentives {
  /** The ownership structure this row applies to. */
  structure: OwnershipState['structure'];
  /**
   * Multiplier on the growth-pressure valuation penalty (0 = no pressure,
   * 1 = full shareholder pressure). Reflects how much the org's stakeholders
   * penalize underperformance.
   */
  growthPressureMultiplier: number;
  /**
   * Multiplier on the business's computed valuation. Reflects market +
   * financing structure (corporations get a liquidity premium; non-profits
   * carry no profit-driven multiple).
   */
  valuationMultiplier: number;
  /**
   * Multiplier on the business's environmental impact (operations footprint).
   * Sustainable enterprises invest in clean process; others don't.
   */
  environmentalImpactMultiplier: number;
  /** Human-readable description of the structure's incentive profile. */
  description: string;
}

export const ORG_TYPE_INCENTIVES: readonly OrgTypeIncentives[] = [
  {
    structure: 'sole-proprietorship',
    growthPressureMultiplier: 0.5,
    valuationMultiplier: 1.0,
    environmentalImpactMultiplier: 1.0,
    description:
      'A single owner who wants profit but has discretion — moderate growth pressure, baseline valuation, no special env investment.',
  },
  {
    structure: 'corporation',
    growthPressureMultiplier: 1.0,
    valuationMultiplier: 1.2,
    environmentalImpactMultiplier: 1.0,
    description:
      'Shareholders demand growth + dividends — full growth pressure (the P3b baseline) + a liquidity premium on valuation. No env investment.',
  },
  {
    structure: 'cooperative',
    growthPressureMultiplier: 0.3,
    valuationMultiplier: 0.85,
    environmentalImpactMultiplier: 0.9,
    description:
      'Member-owned + profit-sharing — gentler growth pressure (members value stability over max return), lower valuation (no speculative premium), slight env care.',
  },
  {
    structure: 'sustainable-enterprise',
    growthPressureMultiplier: 0.4,
    valuationMultiplier: 0.9,
    environmentalImpactMultiplier: 0.5,
    description:
      'Environmental mission is core — moderate growth pressure, slightly lower valuation, HALF the operational environmental footprint (clean process investment).',
  },
  {
    structure: 'non-profit',
    growthPressureMultiplier: 0.0,
    valuationMultiplier: 0.75,
    environmentalImpactMultiplier: 0.8,
    description:
      'Mission-driven — NO growth/profit pressure (surplus is reinvested), lowest valuation (no profit multiple), modest env care.',
  },
  {
    structure: 'state-owned',
    growthPressureMultiplier: 0.2,
    valuationMultiplier: 0.95,
    environmentalImpactMultiplier: 0.9,
    description:
      'Government-backed — low growth pressure (public mandate over profit), near-baseline valuation (stable financing), slight env care from regulation.',
  },
];

const ORG_TYPE_MAP: ReadonlyMap<string, OrgTypeIncentives> = new Map(
  ORG_TYPE_INCENTIVES.map((o) => [o.structure, o]),
);

/** Look up the incentive profile for an org structure. Throws if unknown. */
export function getOrgTypeIncentives(
  structure: OwnershipState['structure'],
): OrgTypeIncentives {
  const entry = ORG_TYPE_MAP.get(structure);
  if (!entry) {
    throw new Error(`Unknown org structure: ${structure}`);
  }
  return entry;
}
