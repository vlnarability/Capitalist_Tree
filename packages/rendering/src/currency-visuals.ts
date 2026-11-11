/**
 * CurrencyVisual definitions — cosmetic appearance of money leaves
 * (TDD §15.4, GDD §14 Monetization and Cosmetics).
 *
 * These are VISUAL DATA, not simulation data. They live in the rendering
 * package — NOT in `packages/content` — because:
 *
 *   - Per GDD §6.1 / TDD §15.1, cosmetics MUST NOT be exposed to the
 *     simulation engine. The sim stores money as bare bigint minor units
 *     keyed by `currencyId` (TDD §10.1); it never inspects or applies
 *     visual properties.
 *   - Per rule 5 (content is data), content packages hold *simulation*
 *     content (species, fertilizers, markets). Visual cosmetics are a
 *     separate concern — they are rendering data, owned by this package.
 *
 * Cosmetic selection MUST NOT modify the underlying monetary value or
 * simulation balance (TDD §15.4). The `id` field on each CurrencyVisual
 * matches the sim's `currencyId` so a player-owned currency can switch
 * cosmetics without affecting balances.
 *
 * P4a ships three cosmetics:
 *   1. leaf-banknote — default, US-dollar-style green banknote leaves.
 *   2. gold-leaf     — premium gold-foil leaves (cosmetic only).
 *   3. euro-leaf     — Euro-style blue/violet banknote leaves.
 *
 * All values here are @provisional per GDD §14 ("Final monetization model"
 * is unresolved) and GDD §17 ("starting currency and initial living
 * expenses" / "currency issuance mechanics").
 */
import type { CurrencyVisual } from './types.js';

/**
 * Default currency visual: US-dollar-style green banknote leaves.
 *
 * `id` matches the sim's `PROVISIONAL_DEFAULT_CURRENCY_ID = 'currency:leaf-dollar'`.
 * Three denomination tiers (1, 5, 25 minor = $0.01, $0.05, $0.25). The White
 * Oak's `leafDenominationMinor = '100'` ($1.00 per leaf) is the *simulated*
 * denomination; this CurrencyVisual's denomination tiers are a separate
 * visual concept — the renderer uses them to draw different leaf sizes
 * across the canopy for visual variety, not for accounting.
 */
export const LEAF_BANKNOTE: CurrencyVisual = {
  id: 'currency:leaf-dollar',
  name: 'Leaf Dollar',
  symbol: '$',
  denominations: [
    { valueMinor: '1', label: '$0.01', leafTier: 0 },
    { valueMinor: '5', label: '$0.05', leafTier: 1 },
    { valueMinor: '25', label: '$0.25', leafTier: 2 },
  ],
  banknoteTheme: 'us-greenback',
  leafAppearance: 'oval-banknote',
};

/**
 * Premium cosmetic: gold-foil leaves. Pure visual — does NOT change the
 * underlying monetary value. The sim's `currencyId` for gold-leaf would be
 * a separate id (e.g. 'currency:gold-leaf'); the renderer maps both
 * `currency:leaf-dollar` and `currency:gold-leaf` ids to visual data via
 * `findCurrencyVisual`, but the *amount* of money in the player's account
 * is unchanged by switching cosmetics.
 *
 * `id = 'currency:gold-leaf'` is reserved for future content that wants a
 * distinct currency (different `currencyId`) with a distinct cosmetic.
 */
export const GOLD_LEAF: CurrencyVisual = {
  id: 'currency:gold-leaf',
  name: 'Gold Leaf',
  symbol: '◈',
  denominations: [
    { valueMinor: '100', label: '1◈', leafTier: 0 },
    { valueMinor: '500', label: '5◈', leafTier: 1 },
    { valueMinor: '2500', label: '25◈', leafTier: 2 },
  ],
  banknoteTheme: 'gold-foil',
  leafAppearance: 'gold-foil',
};

/**
 * Euro cosmetic: blue/violet banknote leaves. Maps to `currency:euro-leaf`.
 * Visual-only — denomination tiers are visual sizes, not accounting values.
 */
export const EURO_LEAF: CurrencyVisual = {
  id: 'currency:euro-leaf',
  name: 'Euro Leaf',
  symbol: '€',
  denominations: [
    { valueMinor: '5', label: '€0.05', leafTier: 0 },
    { valueMinor: '50', label: '€0.50', leafTier: 1 },
    { valueMinor: '500', label: '€5.00', leafTier: 2 },
  ],
  banknoteTheme: 'euro-violet',
  leafAppearance: 'eurostar-leaf',
};

/**
 * All currency visuals shipped by P4a. Add new cosmetics here in later phases.
 */
export const ALL_CURRENCY_VISUALS: readonly CurrencyVisual[] = [
  LEAF_BANKNOTE,
  GOLD_LEAF,
  EURO_LEAF,
];

/**
 * O(1) lookup map keyed by CurrencyVisual.id.
 */
const CURRENCY_VISUAL_MAP: Readonly<Record<string, CurrencyVisual>> = Object.freeze(
  Object.fromEntries(ALL_CURRENCY_VISUALS.map((c) => [c.id, c])),
);

/**
 * Look up a CurrencyVisual by id (TDD §15.4). Returns the visual or
 * `undefined` if the id is unknown — callers (P4d React wrapper) fall back
 * to `getDefaultCurrencyVisual()` in that case.
 */
export function findCurrencyVisual(currencyId: string): CurrencyVisual | undefined {
  return CURRENCY_VISUAL_MAP[currencyId];
}

/**
 * The default CurrencyVisual — used when no cosmetic is selected or when a
 * lookup fails. Returns the leaf-banknote (default currency per
 * `PROVISIONAL_RENDER_DEFAULT_CURRENCY_VISUAL_ID`).
 */
export function getDefaultCurrencyVisual(): CurrencyVisual {
  return LEAF_BANKNOTE;
}

/**
 * Resolve a currency id to a CurrencyVisual, falling back to the default
 * when the id is unknown or undefined. Convenience wrapper around
 * `findCurrencyVisual` + `getDefaultCurrencyVisual`.
 */
export function resolveCurrencyVisual(currencyId: string | undefined | null): CurrencyVisual {
  if (currencyId) {
    const found = findCurrencyVisual(currencyId);
    if (found) return found;
  }
  return getDefaultCurrencyVisual();
}
