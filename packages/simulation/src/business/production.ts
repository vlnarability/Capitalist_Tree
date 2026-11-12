/**
 * Business production (P8b — TDD §5.7 Business State, §11 Personal and
 * Business Accounting; GDD §8.2 Supply Chains, §8.4 Growth Pressure, §8.5
 * Market Simulation).
 *
 * Two exports:
 *
 *   - `runProduction(business, businessType, dtSeconds, marketPrices?, opts?)`:
 *     the PURE production calculation. Computes how much output a business
 *     produces in `dtSeconds`, how much of each input it consumes, the
 *     revenue from selling the output, and the expenses (wages + input
 *     costs). Applies the vertical-integration efficiency bonus
 *     (PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS) when
 *     `opts.hasPlayerOwnedUpstream` is true (GDD §8.2). Does NOT touch
 *     state — returns a plan descriptor. Deterministic given the inputs.
 *
 *   - `operateBusiness(state, business, businessType, ctx)`: the full
 *     per-step orchestration. Resolves supply-chain inputs → runs the
 *     production plan → resolves outputs → moves money (every movement a
 *     `transfer()` transaction — pillar 1 / rule 3) → applies the
 *     environmental impact (via the centralized `applyEnvironmentalImpact`
 *     helper, so the EnvironmentSystem at slot #10 consumes it) → returns
 *     the new state + a `business-operated` event. Used by the
 *     BusinessSystem (every tick, per operating business) AND the
 *     operate-business action handler (manual trigger). Pure transform.
 *
 * Production model (P8b — @provisional, GDD §17 "detailed resource
 * simulation equations" + business balance):
 *
 *   dtFraction       = dtSeconds / SECONDS_PER_DAY
 *   employeeScale    = employees × PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY
 *   effectiveEfficiency = hasPlayerOwnedUpstream
 *                          ? min(1, efficiency + INTEGRATION_BONUS)
 *                          : efficiency
 *   outputProduced   = rate × effectiveEfficiency × employeeScale × dtFraction
 *   inputsConsumed   = [{ resourceId, quantity: outputProduced }] per input
 *                      (1:1 input→output ratio — @provisional)
 *   revenue          = floor(outputProduced × outputMarketPrice)   (bigint)
 *   wages            = floor(employees × wageRate × dtFraction)    (bigint)
 *   inputCosts       = Σ floor(inputQuantity × inputMarketPrice)   (bigint)
 *   expenses         = wages + inputCosts
 *
 * Money movements (rule 3 — every movement a transaction via `transfer()`):
 *   - Revenue: authority → business cash account (issuance,
 *     `'business-revenue'`). New money recognized from selling output
 *     (@provisional — the market is the implicit buyer; P8c routes the
 *     payment from the market/downstream account).
 *   - Wages: business → authority (sink, `'business-wages'`). Cash leaves
 *     circulation (external labor paid).
 *   - Market input purchases: business → market account (transfer,
 *     `'business-input'`). Inputs bought externally.
 *   - Inputs from inventory / upstream: no money movement (already paid for
 *     when they entered inventory / produced by the upstream).
 *
 * Valuation is NOT touched here (TDD §11 — valuation ≠ liquidity; revenue
 * increases cash, not valuation). The BusinessSystem recomputes valuation on
 * a slower cadence (valuation.ts).
 *
 * Pure: `runProduction` returns a plan; `operateBusiness` returns a new
 * state + events. The input is NEVER mutated (TDD §4.1, §18.4).
 */
import type {
  BusinessState,
  BusinessTypeDefinition,
  GameState,
  SimulationEvent,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY,
  PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
} from '@capitalist-tree/shared';
import { transfer, getBalance, parseAmount } from '../economy/ledger.js';
import { applyEnvironmentalImpact } from '../environment/index.js';
import { applyRevenue, applyExpenses } from './accounting.js';
import {
  buildMarketPriceMap,
  resolveInputs,
  resolveOutputs,
  hasPlayerOwnedUpstream,
  SECONDS_PER_DAY,
} from './supply-chain.js';

/** SECONDS_PER_DAY re-exported for tests. */
export { SECONDS_PER_DAY };

/** Transaction categories (free-form strings — NOT Zod enums, per
 *  `packages/shared/src/constants/economy.ts`). */
const CATEGORY_BUSINESS_REVENUE = 'business-revenue';
const CATEGORY_BUSINESS_WAGES = 'business-wages';
const CATEGORY_BUSINESS_INPUT = 'business-input';

/** A required input consumed by production. */
export interface ConsumedInput {
  resourceId: string;
  quantity: number;
}

/** The production plan returned by `runProduction`. */
export interface ProductionPlan {
  /** Fraction of a sim day this operate step covers (dtSeconds / 86400). */
  dtFraction: number;
  /** Effective efficiency after the vertical-integration bonus (if any). */
  effectiveEfficiency: number;
  /** Output quantity produced (may be fractional for sub-day steps). */
  outputProduced: number;
  /** Inputs consumed (1:1 with output — @provisional). */
  inputsConsumed: ConsumedInput[];
  /** Revenue recognized (bigint minor units). */
  revenue: bigint;
  /** Total expenses (wages + input costs, bigint minor units). */
  expenses: bigint;
  /** Wages expense (bigint). */
  wages: bigint;
  /** Input purchase costs (bigint) — informational; actual market cost is
   *  computed by `resolveInputs` (inputs may come from inventory/upstream
   *  at no market cost). */
  inputCosts: bigint;
}

/** Options for `runProduction`. */
export interface RunProductionOptions {
  /** Whether the business has at least one player-owned upstream supplier
   *  (gates the vertical-integration efficiency bonus). The caller derives
   *  this from state via `hasPlayerOwnedUpstream` (runProduction is a pure
   *  calc with no state access). */
  hasPlayerOwnedUpstream?: boolean;
}

/**
 * Compute a business's production plan for one operate step.
 *
 * Pure calculation — does NOT touch state. See the module doc for the
 * formula. `marketPrices` maps resource id → unit price (bigint minor-units
 * string); a resource not in the map has no market price (revenue = 0 for an
 * output with no market; input cost = 0 for an input with no market — the
 * input must then come from inventory / an upstream supplier, else
 * `resolveInputs` reports `insufficient-inputs`).
 *
 * Deterministic given the inputs. The output may be fractional for sub-day
 * steps (e.g. a 60s tick produces rate × eff × empScale / 1440 of a day's
 * output); money amounts are floored to bigint minor units per step (small
 * per-tick amounts floor to 0 — @provisional, mirrors the automation
 * maintenance cost flooring in `automation/execute.ts`).
 */
export function runProduction(
  business: BusinessState,
  _businessType: BusinessTypeDefinition,
  dtSeconds: number,
  marketPrices?: ReadonlyMap<string, string>,
  opts?: RunProductionOptions,
): ProductionPlan {
  const dtFraction = dtSeconds / SECONDS_PER_DAY;
  const employeeScale =
    business.employees * PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY;
  const baseEfficiency = business.production.efficiency;
  const hasUpstream = opts?.hasPlayerOwnedUpstream ?? false;
  const effectiveEfficiency = hasUpstream
    ? Math.min(1, baseEfficiency + PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS)
    : baseEfficiency;

  const rate = business.production.rate;
  const outputProduced = rate * effectiveEfficiency * employeeScale * dtFraction;

  // Inputs consumed: 1:1 with output (@provisional — a future phase derives
  // per-input consumption ratios from the business type).
  const inputsConsumed: ConsumedInput[] = business.production.inputResourceIds.map(
    (resourceId) => ({ resourceId, quantity: outputProduced }),
  );

  // Revenue from selling the output at its market price.
  const outputPriceStr = marketPrices?.get(business.production.outputResourceId);
  const revenue =
    outputPriceStr !== undefined
      ? BigInt(Math.floor(outputProduced * Number(outputPriceStr)))
      : 0n;

  // Wages: employees × wageRate × dtFraction (wageRate is per pay period =
  // per sim day; @provisional). Floored to minor units.
  const wages = BigInt(
    Math.floor(business.employees * Number(business.wageRate) * dtFraction),
  );

  // Input costs (informational — the market cost actually paid is computed by
  // resolveInputs, which accounts for inventory/upstream sources). This is
  // the theoretical cost if every input were bought at market price.
  let inputCosts = 0n;
  for (const input of inputsConsumed) {
    const priceStr = marketPrices?.get(input.resourceId);
    if (priceStr !== undefined) {
      inputCosts += BigInt(Math.floor(input.quantity * Number(priceStr)));
    }
  }

  // Reference _businessType so the param is not flagged unused — future
  // phases may pull per-input consumption ratios or upgrade modifiers from
  // the definition.
  void _businessType;

  return {
    dtFraction,
    effectiveEfficiency,
    outputProduced,
    inputsConsumed,
    revenue,
    expenses: wages + inputCosts,
    wages,
    inputCosts,
  };
}

/** Context for `operateBusiness`. */
export interface OperateBusinessContext {
  /** Simulation second at which the operate step runs (event `at`,
   *  `lastOperatedAt`). */
  now: number;
  /** Length of the operate step in seconds. The BusinessSystem passes
   *  `ctx.stepSeconds`; the operate-business action passes
   *  `PROVISIONAL_SIMULATION_STEP_SECONDS`. */
  dtSeconds: number;
}

/** Reason codes for a skipped operate step (mirrors the event schema enum). */
type OperateSkipReason =
  | 'idle'
  | 'bankrupt'
  | 'liquidating'
  | 'insufficient-inputs'
  | 'insufficient-funds'
  | 'no-employees';

/** Result of `operateBusiness`. */
export interface OperateBusinessResult {
  state: GameState;
  events: SimulationEvent[];
}

/**
 * Build a `business-operated` event for a skipped step (operated: false).
 * Pure.
 */
function skippedOperatedEvent(
  business: BusinessState,
  now: number,
  reason: OperateSkipReason,
): SimulationEvent {
  return {
    type: 'business-operated',
    at: now,
    payload: {
      businessId: business.id,
      operated: false,
      reason,
      outputResourceId: business.production.outputResourceId,
      outputQuantity: 0,
      revenue: '0',
      expenses: '0',
      environmentalImpact: { ...business.environmentalImpact },
      businessCashAfter: business.cash,
    },
  };
}

/**
 * Run one production step for a single business.
 *
 * The full orchestration (see module doc): resolve inputs → run production →
 * resolve outputs → move money (transfer) → apply environmental impact →
 * update business accounting fields. Emits a `business-operated` event
 * (operated: true on success, false + reason on a skip).
 *
 * Skip conditions (graceful — no state change, no money movement):
 *   - `status !== 'operating'` → reason = the status (`'idle'` / `'bankrupt'`
 *     / `'liquidating'`).
 *   - `employees === 0` → reason `'no-employees'`.
 *   - Inputs unsatisfiable (no upstream / inventory / market for a required
 *     input) → reason `'insufficient-inputs'`.
 *   - Business cannot cover wages + market input costs (even with this-tick
 *     revenue) → reason `'insufficient-funds'`.
 *
 * Money movements (rule 3): revenue (authority → business, issuance), wages
 * (business → authority, sink), market input purchases (business → market
 * account, transfer). Each is a `transfer()` with a deterministic requestId
 * derived from `(saveId, now, businessId, kind)` so a re-processed step
 * (save/load) does not double-apply (idempotency, TDD §10.3).
 *
 * Environmental impact: applied via `applyEnvironmentalImpact` (pro-rated by
 * the step fraction) so the EnvironmentSystem at slot #10 consumes the
 * mutated env state (same pattern as `automation/execute.ts`).
 *
 * Pure: returns a new state + events; the input is NEVER mutated.
 */
export function operateBusiness(
  state: GameState,
  business: BusinessState,
  businessType: BusinessTypeDefinition,
  ctx: OperateBusinessContext,
): OperateBusinessResult {
  const { now, dtSeconds } = ctx;
  const events: SimulationEvent[] = [];

  // 1. Status gate.
  if (business.status !== 'operating') {
    events.push(skippedOperatedEvent(business, now, business.status));
    return { state, events };
  }
  // 2. Employee gate.
  if (business.employees <= 0) {
    events.push(skippedOperatedEvent(business, now, 'no-employees'));
    return { state, events };
  }

  // 3. Build the market price maps.
  const marketPriceEntries = buildMarketPriceMap(state);
  const marketPrices = new Map<string, string>();
  for (const [resourceId, entry] of marketPriceEntries) {
    marketPrices.set(resourceId, entry.price);
  }

  // 4. Production plan (with vertical-integration bonus if applicable).
  const hasUpstream = hasPlayerOwnedUpstream(state, business);
  const plan = runProduction(business, businessType, dtSeconds, marketPrices, {
    hasPlayerOwnedUpstream: hasUpstream,
  });

  // 5. Resolve inputs (upstream / inventory / market / unsatisfied).
  const inputs = resolveInputs(state, business, plan.inputsConsumed, marketPriceEntries);
  if (!inputs.satisfied) {
    events.push(skippedOperatedEvent(business, now, 'insufficient-inputs'));
    return { state, events };
  }

  // 6. Funds pre-check: the business must cover wages + market input costs,
  //    net of this-tick revenue (revenue is credited first). transfer()
  //    throws InsufficientFundsError on a negative real-account balance, so
  //    we pre-check to emit a graceful 'insufficient-funds' skip instead.
  const marketCost = parseAmount(inputs.marketCost, 'marketCost');
  const businessAccountBalance = getBalance(state, business.id);
  if (businessAccountBalance + plan.revenue < plan.wages + marketCost) {
    events.push(skippedOperatedEvent(business, now, 'insufficient-funds'));
    return { state, events };
  }

  // 7. Resolve outputs (downstream / market / stockpile).
  const outputs = resolveOutputs(state, business, marketPriceEntries);

  let next: GameState = state;
  const saveId = state.metadata.saveId;

  // 8. Apply money movements (revenue first so expenses can draw on it).
  //    Revenue: authority → business (issuance).
  if (plan.revenue > 0n && outputs.destination !== 'stockpile') {
    next = transfer(next, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: business.id,
      amount: plan.revenue.toString(10),
      category: CATEGORY_BUSINESS_REVENUE,
      description: `Business revenue: ${business.id} sold ${business.production.outputResourceId}`,
      timestamp: now,
      requestId: `business-revenue:${saveId}:${now}:${business.id}`,
    });
  }

  //    Wages: business → authority (sink).
  if (plan.wages > 0n) {
    next = transfer(next, {
      sourceAccount: business.id,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: plan.wages.toString(10),
      category: CATEGORY_BUSINESS_WAGES,
      description: `Business wages: ${business.id} (${business.employees} employees)`,
      timestamp: now,
      requestId: `business-wages:${saveId}:${now}:${business.id}`,
    });
  }

  //    Market input purchases: business → market account (per market-sourced
  //    input). Inputs from inventory / upstream have no money movement.
  for (const src of inputs.sources) {
    if (src.kind !== 'market') continue;
    const cost = BigInt(src.unitPrice) * BigInt(Math.floor(src.quantity));
    if (cost <= 0n) continue;
    next = transfer(next, {
      sourceAccount: business.id,
      destinationAccount: src.marketAccountId,
      amount: cost.toString(10),
      category: CATEGORY_BUSINESS_INPUT,
      description: `Business input: ${business.id} bought ${src.resourceId} from ${src.marketAccountId}`,
      timestamp: now,
      requestId: `business-input:${saveId}:${now}:${business.id}:${src.resourceId}`,
    });
  }

  // 9. Apply inventory movements.
  //    a. Deduct inputs sourced from the shared inventory.
  //    b. Credit the produced output to inventory — but ONLY when the
  //       destination is 'downstream' or 'stockpile' (a 'market' sale does
  //       NOT stockpile; the output is sold to the market and leaves).
  let newItems = next.inventory.items.map((item) => ({ ...item }));
  for (const src of inputs.sources) {
    if (src.kind !== 'inventory') continue;
    const idx = newItems.findIndex((i) => i.resourceId === src.resourceId);
    if (idx >= 0) {
      const existing = newItems[idx]!;
      newItems[idx] = {
        ...existing,
        quantity: Math.max(0, existing.quantity - src.quantity),
      };
    }
  }
  if (plan.outputProduced > 0 && outputs.destination !== 'market') {
    const outputResourceId = business.production.outputResourceId;
    const idx = newItems.findIndex((i) => i.resourceId === outputResourceId);
    if (idx >= 0) {
      const existing = newItems[idx]!;
      newItems[idx] = {
        ...existing,
        quantity: existing.quantity + plan.outputProduced,
      };
    } else {
      newItems = [...newItems, { resourceId: outputResourceId, quantity: plan.outputProduced }];
    }
  }
  next = { ...next, inventory: { items: newItems } };

  // 10. Apply environmental impact (pro-rated by the step fraction via the
  //     centralized helper — same pattern as automation/execute.ts, so the
  //     EnvironmentSystem at slot #10 consumes the mutated env state).
  next = {
    ...next,
    world: {
      ...next.world,
      environment: applyEnvironmentalImpact(
        next.world.environment,
        business.environmentalImpact,
        dtSeconds,
      ),
    },
  };

  // 11. Update the business accounting fields: revenue + expenses
  //     accumulators + cash mirror + lastOperatedAt. The cash field mirrors
  //     the business account balance (transfers already updated the account);
  //     applyRevenue/applyExpenses bump the accumulators + cash field by the
  //     same delta so the mirror stays in sync (same coupling as
  //     player.personalCash).
  const totalInputCost = inputs.sources.reduce((sum, src) => {
    if (src.kind !== 'market') return sum;
    return sum + BigInt(src.unitPrice) * BigInt(Math.floor(src.quantity));
  }, 0n);
  const totalExpenses = plan.wages + totalInputCost;
  const newBusinessAccountBalance = getBalance(next, business.id);
  next = {
    ...next,
    businesses: next.businesses.map((b) => {
      if (b.id !== business.id) return b;
      let nb = applyRevenue(b, plan.revenue);
      nb = applyExpenses(nb, totalExpenses);
      // Sync the cash mirror to the authoritative account balance (catches
      // any drift from the per-component applyRevenue/applyExpenses).
      nb = { ...nb, cash: newBusinessAccountBalance.toString(10) };
      nb = { ...nb, lastOperatedAt: now };
      return nb;
    }),
  };

  // 12. Emit business-operated (operated: true).
  const updatedBusiness = next.businesses.find((b) => b.id === business.id)!;
  events.push({
    type: 'business-operated',
    at: now,
    payload: {
      businessId: business.id,
      operated: true,
      outputResourceId: business.production.outputResourceId,
      outputQuantity: plan.outputProduced,
      revenue: plan.revenue.toString(10),
      expenses: totalExpenses.toString(10),
      environmentalImpact: { ...business.environmentalImpact },
      businessCashAfter: updatedBusiness.cash,
    },
  });

  return { state: next, events };
}
