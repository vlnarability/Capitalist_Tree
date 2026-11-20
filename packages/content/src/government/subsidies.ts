/**
 * Subsidy-to-commodity target mapping (P13-B / GAP-25 — GDD §6.2 subsidies).
 *
 * Closes the dead-data gap: `GovernmentPolicy.subsidies` were written by
 * `updateGovernmentPolicy` (e.g. `event:subsidy-granted` grants
 * `subsidy:sustainable-industry` when land degradation is high) but never read
 * back. This table maps each subsidy program type to the commodity ids it
 * discounts; `applyPurchase` (economy/markets.ts) consults it via
 * `getSubsidyRateForCommodity` + issues a rebate (= totalCost × rate) from the
 * authority (mint) to the player — the government deficit-spends the subsidy,
 * the market stays whole, the player's net cost drops by the rebate.
 *
 * Adding a new subsidy type = append a row here + grant it via an event /
 * `set-government-policy`. The mapping is pure data; the simulation reads it.
 */
export interface SubsidyTarget {
  /** Subsidy program type id (matches `GovernmentPolicy.subsidies[].type`). */
  type: string;
  /** Commodity ids (market `commodityId`) this subsidy discounts. */
  commodityIds: readonly string[];
  /** Human-readable description of what the subsidy encourages. */
  description: string;
}

export const SUBSIDY_TARGETS: readonly SubsidyTarget[] = [
  {
    type: 'subsidy:sustainable-industry',
    commodityIds: ['resource:equipment', 'fertilizer:balanced-10-10-10'],
    description:
      'Discounts sustainable-industry inputs (equipment + fertilizer). Granted by the event:subsidy-granted event when land degradation is high, to encourage cleaner production.',
  },
  {
    type: 'subsidy:renewable-energy',
    commodityIds: ['resource:energy'],
    description:
      'Discounts energy purchases to encourage renewable / low-carbon energy adoption.',
  },
  {
    type: 'subsidy:water-conservation',
    commodityIds: ['resource:water'],
    description:
      'Discounts irrigation water to encourage efficient water use + conservation.',
  },
  {
    type: 'subsidy:sapling-planting',
    commodityIds: ['resource:seeds'],
    description:
      'Discounts sapling / seed purchases to encourage reforestation + planting.',
  },
];

/** Map commodity id → the subsidy types that discount it. */
const COMMODITY_TO_SUBSIDY_TYPES: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const target of SUBSIDY_TARGETS) {
    for (const commodityId of target.commodityIds) {
      const list = map.get(commodityId);
      if (list) {
        list.push(target.type);
      } else {
        map.set(commodityId, [target.type]);
      }
    }
  }
  return map;
})();

/**
 * Sum the rates of all active subsidies that target the given commodity,
 * capped at 1 (a fully-discounted purchase). Returns 0 if no active subsidy
 * targets the commodity.
 *
 * @param activeSubsidies the current `GovernmentPolicy.subsidies` list.
 * @param commodityId the market commodity id being purchased.
 */
export function getSubsidyRateForCommodity(
  activeSubsidies: readonly { type: string; rate: number }[],
  commodityId: string,
): number {
  const matchingTypes = COMMODITY_TO_SUBSIDY_TYPES.get(commodityId);
  if (!matchingTypes) return 0;
  let sum = 0;
  for (const sub of activeSubsidies) {
    if (matchingTypes.includes(sub.type)) {
      sum += sub.rate;
    }
  }
  return Math.max(0, Math.min(1, sum));
}
