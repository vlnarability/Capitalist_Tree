import { z } from 'zod';
import { environmentalImpactSchema } from './automation.js';

export const ownershipStateSchema = z.object({
  ownerId: z.string().min(1),
  // PROVISIONAL: organizational structure (GDD §8.3). P0 only supported
  // sole proprietorships; the enum was widened over time.
  //
  // P8a (GDD §8.3): 'sustainable-enterprise' added — the GDD lists six
  // economic organizations (sole proprietorships, corporations, cooperatives,
  // sustainable enterprises, non-profit organizations, state-owned
  // enterprises) but the P0 enum was missing 'sustainable-enterprise'. Zod
  // enum widening is backward-compatible: saves written with the old enum
  // (without 'sustainable-enterprise') still parse cleanly because every old
  // value is still a member of the widened enum.
  structure: z.enum([
    'sole-proprietorship',
    'corporation',
    'cooperative',
    'sustainable-enterprise',
    'non-profit',
    'state-owned',
  ]),
  share: z.number().min(0).max(1),
});
export type OwnershipState = z.infer<typeof ownershipStateSchema>;

export const businessAssetSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
});
export type BusinessAsset = z.infer<typeof businessAssetSchema>;

export const liabilitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  principal: z.string(),
  interestRate: z.number(),
  dueAt: z.number().int().nonnegative(),
  // P8c (GDD §8.4 debt and interest growth pressure — resolves P8b carry-
  // forward #3): accrued-but-unpaid interest, tracked SEPARATELY from the
  // principal. P8b compounded accrued interest into `principal` each tick
  // (so repay-loan could not split interest from principal). P8c accrues
  // interest into this field each tick via `accrueInterest` /
  // `accrueDebtInterest`; the `repay-loan` action pays `accruedInterest`
  // FIRST, then reduces `principal`. Zod `.default('0')` so v10 saves parse
  // cleanly under v11; the v10 → v11 migration backfills it explicitly.
  accruedInterest: z.string().default('0'),
});
export type Liability = z.infer<typeof liabilitySchema>;

export const productionStateSchema = z.object({
  inputResourceIds: z.array(z.string()),
  outputResourceId: z.string(),
  rate: z.number().nonnegative(),
  efficiency: z.number().min(0).max(1),
});
export type ProductionState = z.infer<typeof productionStateSchema>;

/**
 * Business category (P8a — GDD §8.2 supply chains, §8.5 markets).
 *
 * Coarse classification for the shop / UI. The `supplyChainLevel` field on
 * the BusinessTypeDefinition carries the precise position in the chain
 * (0=extraction ... 5=application); `category` is the human-facing bucket.
 *
 *   - `extraction`     : raw material extraction (water, minerals).
 *   - `processing`     : chemical / mechanical processing of raw materials.
 *   - `manufacturing`  : finished-goods manufacturing (fertilizer, equipment).
 *   - `distribution`   : logistics / wholesale distribution.
 *   - `retail`         : consumer-facing retail.
 *   - `application`    : end-use application (a farm applies fertilizer +
 *     grows food — the agricultural application tier of GDD §8.2's
 *     fertilizer supply chain example).
 */
export const businessCategorySchema = z.enum([
  'extraction',
  'processing',
  'manufacturing',
  'distribution',
  'retail',
  'application',
]);
export type BusinessCategory = z.infer<typeof businessCategorySchema>;

/**
 * GameAction `type` strings a business type can be driven by. Mirrors
 * equipment's `supportedActions` — content declares which business actions
 * make sense for the type (e.g. a `farm` supports `operate-business` but
 * not `take-loan` by default; a `mineral-mine` supports both). The handler
 * (P8b) uses this as a content gate: dispatching an unsupported action
 * against a business raises `UnsupportedBusinessActionError`.
 */
export const businessSupportedActionSchema = z.enum([
  'purchase-business',
  'operate-business',
  'sell-business',
  'take-loan',
  'repay-loan',
  'hire-employees',
  'lay-off-employees',
  'set-business-status',
]);

/**
 * Static business type definition — pure data (P8a — TDD §5.7 / §11, GDD §8).
 *
 * The BusinessSystem (P8b) reads a definition to derive a `BusinessState` at
 * purchase time:
 *   - `supplyChainLevel`     ← `supplyChainLevel`
 *   - `production`           ← `defaultProduction`
 *   - `wageRate`             ← `baseWageRate`
 *   - `environmentalImpact`  ← `baseEnvironmentalImpact`
 *   - `marketParticipation`  ← `marketParticipation`
 *   - `employees`            ← `baseEmployees`
 *   - `valuation`            ← `baseValuation`
 *
 * `baseCost` is the one-time purchase price (debited from `player:personal`
 * once via `purchase-business`). `baseValuation` is the starting valuation
 * (separate from cash — TDD §11: valuation ≠ liquidity; the business starts
 * with `cash: '0'` and `valuation: baseValuation`). `baseWageRate` is the
 * bigint minor-units wage per employee per pay period.
 *
 * `supportedActions` lists the `GameAction['type']` strings this business
 * type supports (content gate — see `businessSupportedActionSchema`).
 *
 * `marketParticipation` lists which commodity markets this business buys
 * inputs from / sells outputs into (GDD §8.5: water, fertilizer, seeds,
 * equipment, food, energy, labor, land). Market ids are content-defined
 * (e.g. `'market:water'`, `'market:fertilizer'`).
 *
 * PROVISIONAL: every numeric field is provisional per GDD §17 ("detailed
 * resource simulation equations" + business balance). All costs are bigint
 * minor currency units serialized as string (TDD §10.1) — money is bigint,
 * never floating point.
 */
export const businessTypeDefinitionSchema = z.object({
  /** Unique business type id, e.g. `'business:water-extraction-plant'`. */
  id: z.string().min(1),
  /** Human-readable name for the shop / UI. */
  name: z.string().min(1),
  /** Short description for the UI / docs. */
  description: z.string(),
  /** Coarse category (GDD §8.2 / §8.5). */
  category: businessCategorySchema,
  /** Position in the supply chain (GDD §8.2). 0=extraction, 1=processing,
   *  2=manufacturing, 3=distribution, 4=retail, 5=application. */
  supplyChainLevel: z.number().int().min(0).max(5),
  /** Default production configuration (inputs consumed, output produced,
   *  rate, efficiency). Copied onto the BusinessState at purchase. */
  defaultProduction: productionStateSchema,
  /** One-time purchase price (bigint minor units as string — TDD §10.1). */
  baseCost: z.string().min(1),
  /** Starting employee count. */
  baseEmployees: z.number().int().nonnegative(),
  /** Wage per employee per pay period (bigint minor units as string). */
  baseWageRate: z.string(),
  /** Environmental impact per operate step (pillar 4 — GDD §8.3). */
  baseEnvironmentalImpact: environmentalImpactSchema,
  /** Starting valuation (bigint minor units as string). Separate from cash
   *  (TDD §11 — valuation ≠ liquidity). */
  baseValuation: z.string(),
  /** Commodity markets this business participates in (GDD §8.5). */
  marketParticipation: z.array(z.string().min(1)),
  /** GameAction `type` strings this business type supports. */
  supportedActions: z.array(businessSupportedActionSchema),
});
export type BusinessTypeDefinition = z.infer<typeof businessTypeDefinitionSchema>;

/**
 * Business operational status (P8a — TDD §5.7, GDD §8.4 Growth Pressure).
 *
 * The BusinessSystem (P8b) drives a business through these states. A
 * business that cannot meet its obligations (cash below
 * PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD) transitions to `bankrupt`;
 * `liquidating` is the intermediate state during a `sell-business` wind-down.
 * `idle` is a player-chosen pause (set via `set-business-status`) that
 * suspends production without dismantling the business.
 */
export const businessStatusSchema = z.enum(['operating', 'idle', 'bankrupt', 'liquidating']);
export type BusinessStatus = z.infer<typeof businessStatusSchema>;

/**
 * Business state (TDD §5.7, GDD §8).
 *
 * Business cash/assets/liabilities are bigint minor units (string).
 * Valuation is separate from cash (TDD §5.7 / TDD §11): an increase in asset
 * valuation does NOT automatically generate spendable money. The player
 * cannot spend business valuation directly without selling assets, borrowing,
 * or raising capital (TDD §11).
 *
 * P8a additions (backward compatible — all new fields have Zod `.default(...)`
 * so v9 saves parse cleanly under v10, and the v9 → v10 migration backfills
 * them explicitly so consumers can rely on their presence without re-running
 * the zod default pipeline):
 *   - `status`: operational state (`operating` | `idle` | `bankrupt` |
 *     `liquidating`). Default `'operating'`.
 *   - `lastOperatedAt`: simulation seconds at which the BusinessSystem last
 *     ran production for this business. Used for cooldown / idle detection.
 *     Default `0`.
 *   - `supplyChainLevel`: position in the supply chain (GDD §8.2).
 *     0 = raw extraction, 1 = chemical/processing, 2 = manufacturing,
 *     3 = distribution, 4 = retail, 5 = application. Default `0`.
 *   - `upstreamSupplierIds`: business ids this one buys inputs from (GDD §8.2
 *     vertical integration). Default `[]`.
 *   - `downstreamCustomerIds`: business ids this one sells outputs to.
 *     Default `[]`.
 *   - `environmentalImpact`: per-business impact, reusing the P6
 *     `environmentalImpactSchema` (pillar 4). Default all-zero.
 *   - `wageRate`: bigint minor-units wage per employee per pay period.
 *     Default `'0'`.
 *   - `marketParticipation`: which markets this business buys/sells in
 *     (GDD §8.5: water, fertilizer, seeds, equipment, food, energy, labor,
 *     land). Default `[]`.
 *   - `lastValuationTick`: simulation seconds at which `valuation` was last
 *     recomputed (TDD §11 — valuation ≠ liquidity; the BusinessSystem
 *     recomputes it on a slower cadence than per-tick cash moves). Default
 *     `0`.
 *
 * All new fields are populated from the corresponding BusinessTypeDefinition
 * at purchase time (P8b): `supplyChainLevel`, `wageRate`, `environmentalImpact`,
 * `marketParticipation`, and `production` come from the definition's base
 * values; `upstreamSupplierIds` / `downstreamCustomerIds` start empty and are
 * wired by the player's vertical-integration actions. `status`,
 * `lastOperatedAt`, and `lastValuationTick` start at their defaults.
 */
export const businessStateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  ownership: ownershipStateSchema,
  cash: z.string(),
  assets: z.array(businessAssetSchema),
  liabilities: z.array(liabilitySchema),
  revenue: z.string(),
  expenses: z.string(),
  valuation: z.string(),
  employees: z.number().int().nonnegative(),
  production: productionStateSchema,
  // P8a operational fields (TDD §5.7 / §11, GDD §8.2 / §8.3 / §8.4 / §8.5).
  // All have Zod `.default(...)` so v9 saves parse cleanly under v10.
  status: businessStatusSchema.default('operating'),
  lastOperatedAt: z.number().nonnegative().default(0),
  supplyChainLevel: z.number().int().nonnegative().default(0),
  upstreamSupplierIds: z.array(z.string()).default([]),
  downstreamCustomerIds: z.array(z.string()).default([]),
  environmentalImpact: environmentalImpactSchema.default({
    carbonEmissions: 0,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0,
    biodiversityImpact: 0,
  }),
  wageRate: z.string().default('0'),
  marketParticipation: z.array(z.string()).default([]),
  lastValuationTick: z.number().nonnegative().default(0),
  // P8c (GDD §8.2 supply chains, §8.5 Market Simulation — resolves P8b
  // carry-forward #2): per-business resource stocks. P8b used the shared
  // `state.inventory` pool as a workaround because BusinessState had no
  // inventory field. P8c adds this field so each business holds its own
  // inputs/outputs between ticks: production consumes from this inventory,
  // outputs are credited here (then sold to the market or pushed to a
  // downstream customer's inventory). The shared `state.inventory` remains
  // the PLAYER's inventory (water/fertilizer/seeds bought by the player).
  // Shape mirrors `inventoryStateSchema.items` for consistency. Zod
  // `.default([])` so v10 saves parse cleanly under v11; the v10 → v11
  // migration backfills it explicitly.
  inventory: z
    .array(
      z.object({
        resourceId: z.string().min(1),
        quantity: z.number().nonnegative(),
      }),
    )
    .default([]),
});
export type BusinessState = z.infer<typeof businessStateSchema>;
