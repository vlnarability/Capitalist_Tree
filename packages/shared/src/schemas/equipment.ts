import { z } from 'zod';
import { environmentalImpactSchema } from './automation.js';

/**
 * Equipment definitions (P6b1 — TDD §12, GDD §9 "Automation and Technology").
 *
 * Equipment is the static *content* that backs an `AutomationState`. A
 * player purchases equipment via the `purchase-equipment` action; the handler
 * (P6b2) debits the cost from `player:personal`, instantiates an
 * `AutomationState` derived from this definition, appends it to
 * `state.automation`, and emits an `equipment-purchased` event.
 *
 * Equipment data lives in `packages/content/src/equipment/` (rule 5: content
 * is data, never hardcoded in engine logic). Each file covers one category;
 * `index.ts` re-exports a flat `EQUIPMENT` array and a `getEquipmentById`
 * helper, mirroring the `fertilizers/` and `markets/` content registries.
 *
 * GDD §9 splits automation into "initial" (watering, fertilizing, harvesting,
 * monitoring) and "advanced" (industrial irrigation, mechanical harvesting,
 * autonomous equipment). The `category` enum captures the initial set plus an
 * `energy` category for power-generation/storage equipment that offsets the
 * energy costs pillar 4 warns about. Advanced categories (manufacturing,
 * supply-chain) are deferred.
 *
 * `tier` (1–3) maps to GDD §9's progression: tier 1 = entry-level initial
 * automation, tier 2 = improved, tier 3 = industrial/autonomous. Higher tiers
 * cost more up front but (provisionally) consume less energy per unit of work
 * and have lower per-run environmental impact — the pillar-4 trade-off
 * (efficiency vs. sustainability) is tuned here.
 *
 * All numeric tuning is PROVISIONAL per GDD §17 ("detailed resource simulation
 * equations" + "automation cost/effectiveness balance"). Costs are bigint
 * minor currency units serialized as string (TDD §10.1) — money is bigint,
 * never floating point.
 */

/**
 * Equipment category (GDD §9).
 *
 *   - `irrigation`   : automatic watering (sprinklers, drip lines).
 *   - `fertilization`: automatic fertilizer application (spreaders).
 *   - `harvesting`   : automatic leaf harvesting (shakers, pickers).
 *   - `monitoring`   : sensing equipment that drives threshold policies
 *                      (soil sensors, weather stations) — produces readings
 *                      rather than executing actions directly.
 *   - `energy`       : power generation/storage (solar panels, batteries)
 *                      that offsets the `energyConsumption` of other
 *                      equipment (pillar 4 trade-off).
 */
export const equipmentCategorySchema = z.enum([
  'irrigation',
  'fertilization',
  'harvesting',
  'monitoring',
  'energy',
]);
export type EquipmentCategory = z.infer<typeof equipmentCategorySchema>;

/**
 * Equipment tier (GDD §9 progression). 1 = entry, 2 = improved, 3 = industrial.
 */
export const equipmentTierSchema = z.number().int().min(1).max(3);
export type EquipmentTier = z.infer<typeof equipmentTierSchema>;

/**
 * Policy kinds an piece of equipment can be configured with. Mirrors the
 * `automationPolicySchema` discriminator values so content can declare which
 * trigger styles it supports (e.g. a soil sensor supports `threshold`; a
 * harvester supports `threshold` + `event` + `schedule`).
 */
export const equipmentSupportedPolicySchema = z.enum(['threshold', 'event', 'schedule']);

/**
 * Optional unlock gate. Absent = available from the start. Present = the
 * player must meet the listed minimums before the equipment appears in the
 * shop / becomes purchasable. `minTreeMaturity` is a [0,1] fraction of the
 * tree's mature size; `minPlayerLevel` is a future progression counter (P6+).
 */
export const equipmentUnlockRequirementsSchema = z
  .object({
    minTreeMaturity: z.number().min(0).max(1).optional(),
    minPlayerLevel: z.number().int().nonnegative().optional(),
  })
  .optional();
export type EquipmentUnlockRequirements = z.infer<typeof equipmentUnlockRequirementsSchema>;

/**
 * Static equipment definition — pure data (TDD §12, GDD §9).
 *
 * The P6b2 AutomationSystem reads a definition to derive an
 * `AutomationState` at purchase time:
 *   - `energyConsumption` ← `baseEnergyConsumption`
 *   - `maintenanceCost`   ← `baseMaintenanceCost` (per sim day)
 *   - `environmentalImpact` ← `baseEnvironmentalImpact`
 *   - `resourceConsumption` ← derived from `supportedActions` (e.g. an
 *     irrigation sprinkler consumes `resource:water`)
 *
 * `cost` is the one-time purchase price (debited once). `baseMaintenanceCost`
 * is recurring per sim day (accrued by the PersonalSystem / a future
 * maintenance ledger). Both are bigint minor units as string.
 *
 * `supportedActions` lists the `GameAction['type']` strings this equipment
 * can execute when its policy fires (e.g. `['apply-water']` for a sprinkler).
 * `supportedPolicies` lists the policy `kind` values it accepts. A monitoring
 * sensor may have empty `supportedActions` (it produces readings, not
 * actions) but non-empty `supportedPolicies` (it feeds threshold triggers).
 *
 * PROVISIONAL: every numeric field is provisional per GDD §17.
 */
export const equipmentDefinitionSchema = z.object({
  /** Unique equipment id, e.g. `'equipment:sprinkler-t1'`. */
  id: z.string().min(1),
  /** Human-readable name for the shop / UI. */
  name: z.string().min(1),
  /** Short description for the UI / docs. */
  description: z.string(),
  /** Equipment category (GDD §9). */
  category: equipmentCategorySchema,
  /** Tier 1–3 (GDD §9 progression). */
  tier: equipmentTierSchema,
  /** One-time purchase price (bigint minor units as string — TDD §10.1). */
  cost: z.string().min(1),
  /** Energy consumed per sim day when active (kWh-equivalent, PROVISIONAL). */
  baseEnergyConsumption: z.number().nonnegative(),
  /** Recurring maintenance cost per sim day (bigint minor units as string). */
  baseMaintenanceCost: z.string().min(1),
  /** Environmental impact per sim day of operation (pillar 4 — GDD §9.1). */
  baseEnvironmentalImpact: environmentalImpactSchema,
  /** GameAction `type` strings this equipment can execute. May be empty for
   *  monitoring/energy equipment that produces readings or offsets rather
   *  than actions. */
  supportedActions: z.array(z.string().min(1)),
  /** Policy `kind` values this equipment accepts. */
  supportedPolicies: z.array(equipmentSupportedPolicySchema),
  /** Optional unlock gate (tree maturity / player level). */
  unlockRequirements: equipmentUnlockRequirementsSchema,
});
export type EquipmentDefinition = z.infer<typeof equipmentDefinitionSchema>;
