/**
 * Business action handlers (P8b — TDD §5.7 / §11, GDD §8.1 / §8.2 / §8.3 /
 * §8.4 / §8.5).
 *
 * Eight player-facing actions live here, registered in the action dispatch
 * (`packages/simulation/src/actions/handlers.ts`) and dispatched by
 * `executeAction` via the `actionHandlers` map:
 *
 *   - `purchase-business`: instantiate a business from a
 *     BusinessTypeDefinition (content gate). Debits `baseCost` from
 *     `player:personal` (sink to the authority), registers a `business`-
 *     type cash account, derives a BusinessState, appends it to
 *     `state.businesses`. Emits `business-purchased`.
 *   - `operate-business`: run one production cycle for a business (delegates
 *     to the shared `operateBusiness` orchestration). Emits `business-operated`.
 *   - `sell-business`: liquidate — settle liabilities from the business's
 *     cash + the valuation proceeds (valuation × (1 − HAIRCUT), TDD §11),
 *     credit the residue to `player:personal`, remove the business + its
 *     account. Emits `business-sold`.
 *   - `take-loan`: create a Liability, credit the principal to the business
 *     via an authority issuance. Emits `loan-taken`.
 *   - `repay-loan`: debit the business, sink to the authority, reduce the
 *     liability principal. Emits `loan-repaid`.
 *   - `hire-employees` / `lay-off-employees`: adjust `employees`. Emit
 *     `employees-hired` / `employees-laid-off`.
 *   - `set-business-status`: flip between `operating` and `idle` (rejects
 *     `bankrupt` / `liquidating` — system-internal transitions). Idempotent.
 *
 * All handlers are pure: they return a new state + events without mutating
 * the input. Deterministic given (state, action) — every money movement
 * carries a deterministic `requestId` derived from (saveId, simSecond,
 * businessId, kind) so a replayed action (save/load) does not double-apply
 * (idempotency, TDD §10.3).
 *
 * Money NEVER silently created or destroyed (TDD §10.4): purchases are sinks
 * (player → authority); loans are issuances (authority → business); repayments
 * are sinks (business → authority); revenue is an issuance (authority →
 * business); wages are sinks (business → authority); market input purchases
 * are transfers (business → market account); sale proceeds are an issuance
 * (authority → business, then residue → player). The conservation invariant
 * holds by construction.
 *
 * The `originalTree` is NEVER touched by any business action (GDD §16.1 /
 * §16.2 — the original tree is sacred and is not a business asset; the
 * schema-layer superRefine plus the `sell-tree` action guard already enforce
 * this, and no business action references `state.originalTree`).
 */
import type {
  BusinessState,
  BusinessTypeDefinition,
  GameState,
  SimulationEvent,
  PurchaseBusinessAction,
  OperateBusinessAction,
  SellBusinessAction,
  TakeLoanAction,
  RepayLoanAction,
  HireEmployeesAction,
  LayOffEmployeesAction,
  SetBusinessStatusAction,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_BUSINESS_VALUATION_HAIRCUT,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';
import { getBusinessTypeById } from '@capitalist-tree/content';
import type { ActionListener } from '../actions/handlers.js';
import {
  transfer,
  getBalance,
  parseAmount,
  registerAccount,
  isRequestProcessed,
} from '../economy/ledger.js';
import { operateBusiness } from './production.js';
import { sumLiabilities, parseBusinessAmount } from './accounting.js';
import {
  UnknownBusinessError,
  UnknownBusinessTypeError,
  UnsupportedBusinessActionError,
  UnknownLiabilityError,
  InvalidBusinessStatusError,
} from './errors.js';

/** Transaction categories (free-form strings — NOT Zod enums). */
const CATEGORY_BUSINESS_PURCHASE = 'business-purchase';
const CATEGORY_BUSINESS_SALE = 'business-sale';
const CATEGORY_BUSINESS_LOAN = 'business-loan';
const CATEGORY_BUSINESS_LOAN_REPAYMENT = 'business-loan-repayment';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a BusinessTypeDefinition by id (content gate). Throws
 * `UnknownBusinessTypeError` if the id is not registered.
 */
function requireBusinessType(businessTypeId: string): BusinessTypeDefinition {
  const def = getBusinessTypeById(businessTypeId);
  if (!def) {
    throw new UnknownBusinessTypeError(businessTypeId);
  }
  return def;
}

/**
 * Find a business by id. Throws `UnknownBusinessError` if not in
 * `state.businesses`.
 */
function requireBusiness(state: GameState, businessId: string): BusinessState {
  const business = state.businesses.find((b) => b.id === businessId);
  if (!business) {
    throw new UnknownBusinessError(businessId);
  }
  return business;
}

/**
 * Content gate: throw `UnsupportedBusinessActionError` if the business type's
 * `supportedActions` does not include `actionType`.
 */
function requireSupportedAction(
  definition: BusinessTypeDefinition,
  actionType: string,
  businessId: string,
): void {
  if (!definition.supportedActions.includes(actionType as never)) {
    throw new UnsupportedBusinessActionError(
      businessId,
      actionType,
      definition.supportedActions,
    );
  }
}

/**
 * Derive a deterministic business id from a purchase action.
 *
 * `business:<typeSlug>:<index>` where `<typeSlug>` is the type id with the
 * `business:` prefix stripped, and `<index>` is the pre-purchase length of
 * `state.businesses` (so two purchases of the same type get distinct ids).
 * Deterministic given the same purchase sequence (TDD §18.3).
 */
function deriveBusinessId(state: GameState, typeId: string): string {
  const slug = typeId.replace(/^business:/, '');
  const index = state.businesses.length;
  return `business:${slug}:${index}`;
}

/**
 * Derive a BusinessState from a BusinessTypeDefinition at purchase time.
 *
 * Copies `supplyChainLevel`, `production`, `wageRate`,
 * `environmentalImpact`, `marketParticipation`, `employees`, and `valuation`
 * from the definition. `cash` starts at '0' (the purchase price went to the
 * seller / was sunk, not the business — TDD §11). `ownership` defaults to a
 * sole proprietorship (player owns 100% via `player:personal`). The P8a
 * operational fields (`status`, `lastOperatedAt`, `upstreamSupplierIds`,
 * `downstreamCustomerIds`, `lastValuationTick`) start at their defaults.
 *
 * Pure: takes the definition + ids, returns a BusinessState.
 */
export function createBusinessFromDefinition(
  definition: BusinessTypeDefinition,
  businessId: string,
  name: string,
): BusinessState {
  return {
    id: businessId,
    name,
    type: definition.id,
    ownership: {
      ownerId: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      structure: 'sole-proprietorship',
      share: 1.0,
    },
    cash: '0',
    assets: [],
    liabilities: [],
    revenue: '0',
    expenses: '0',
    valuation: definition.baseValuation,
    employees: definition.baseEmployees,
    production: {
      inputResourceIds: [...definition.defaultProduction.inputResourceIds],
      outputResourceId: definition.defaultProduction.outputResourceId,
      rate: definition.defaultProduction.rate,
      efficiency: definition.defaultProduction.efficiency,
    },
    status: 'operating',
    lastOperatedAt: 0,
    supplyChainLevel: definition.supplyChainLevel,
    upstreamSupplierIds: [],
    downstreamCustomerIds: [],
    environmentalImpact: { ...definition.baseEnvironmentalImpact },
    wageRate: definition.baseWageRate,
    marketParticipation: [...definition.marketParticipation],
    lastValuationTick: 0,
  };
}

/** Mirror a business account's balance onto `business.cash` (denormalized
 *  view, same coupling as `player.personalCash`). Returns a new state. */
function syncBusinessCash(state: GameState, businessId: string): GameState {
  const balance = getBalance(state, businessId).toString(10);
  return {
    ...state,
    businesses: state.businesses.map((b) =>
      b.id === businessId ? { ...b, cash: balance } : b,
    ),
  };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * `purchase-business` action handler (P8b — TDD §5.7 / §11, GDD §8.1).
 *
 *   1. Resolve the business type via `getBusinessTypeById` (content gate).
 *      Content gate: `supportedActions` must include `'purchase-business'`.
 *   2. Debit `definition.baseCost` from `player:personal` (sink to the
 *      authority — money leaves circulation; the business asset appears on
 *      the business's balance sheet as valuation, not as circulating money).
 *      Idempotent via the `requestId`.
 *   3. Register a `business`-type cash account (id = the new business id,
 *      balance '0').
 *   4. Derive a BusinessState from the definition (via
 *      `createBusinessFromDefinition`).
 *   5. Append the business to `state.businesses`.
 *   6. Emit `business-purchased`.
 *
 * Pure: returns a new state, never mutates input. Deterministic given
 * (state, action).
 */
export const purchaseBusinessHandler: ActionListener<PurchaseBusinessAction> = (
  state,
  action,
) => {
  const { businessTypeId, name } = action.payload;
  const definition = requireBusinessType(businessTypeId);
  // Content gate (the type lists its supported actions).
  requireSupportedAction(definition, 'purchase-business', businessTypeId);

  const businessId = deriveBusinessId(state, businessTypeId);
  const saveId = state.metadata.saveId;
  const timestamp = state.clock.elapsedSeconds;
  const cost = parseAmount(definition.baseCost, 'baseCost');

  // Idempotency: a replayed purchase (save/load mid-action) returns state
  // unchanged with no events.
  const requestId = `business-purchase:${saveId}:${businessId}`;
  if (isRequestProcessed(state, requestId)) {
    return { state, events: [] };
  }

  // 1. Debit the player:personal account, sinking the cost to the authority.
  let next: GameState = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    amount: cost.toString(10),
    category: CATEGORY_BUSINESS_PURCHASE,
    description: `Purchase business ${businessTypeId} → ${businessId}`,
    timestamp,
    requestId,
  });

  // Mirror the new player balance to player.personalCash.
  const playerBalanceAfter = getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
  if (playerBalanceAfter.toString(10) !== next.player.personalCash) {
    next = {
      ...next,
      player: { ...next.player, personalCash: playerBalanceAfter.toString(10) },
    };
  }

  // 2. Register the business cash account (balance '0' — the purchase price
  //    went to the seller, not the business).
  next = registerAccount(next, {
    id: businessId,
    type: 'business',
    label: `Business — ${name ?? definition.name}`,
    balance: '0',
  });

  // 3. Derive + append the BusinessState.
  const business = createBusinessFromDefinition(definition, businessId, name ?? definition.name);
  next = { ...next, businesses: [...next.businesses, business] };

  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: timestamp,
      payload: {
        record: next.economy.transactions[next.economy.transactions.length - 1]!,
      },
    },
    {
      type: 'business-purchased',
      at: timestamp,
      payload: {
        businessTypeId,
        businessId,
        cost: cost.toString(10),
        playerBalanceAfter: playerBalanceAfter.toString(10),
      },
    },
  ];

  return { state: next, events };
};

/**
 * `operate-business` action handler (P8b — GDD §8.2 / §8.4 / §8.5).
 *
 * Delegates to the shared `operateBusiness` orchestration (the same one the
 * BusinessSystem uses every tick). The action runs ONE production cycle at
 * `payload.tick` with `dtSeconds = PROVISIONAL_SIMULATION_STEP_SECONDS` (one
 * tick of production). Content gate: the business type's `supportedActions`
 * must include `'operate-business'`.
 *
 * Pure: returns a new state + the `business-operated` event(s).
 */
export const operateBusinessHandler: ActionListener<OperateBusinessAction> = (
  state,
  action,
) => {
  const { businessId, tick } = action.payload;
  const business = requireBusiness(state, businessId);
  const definition = requireBusinessType(business.type);
  requireSupportedAction(definition, 'operate-business', businessId);

  const result = operateBusiness(state, business, definition, {
    now: tick,
    dtSeconds: PROVISIONAL_SIMULATION_STEP_SECONDS,
  });
  return { state: result.state, events: result.events };
};

/**
 * `sell-business` action handler (P8b — TDD §11 valuation ≠ liquidity; GDD
 * §8.1 financial separation).
 *
 *   1. Find the business (content gate: `supportedActions` includes
 *      `'sell-business'`).
 *   2. Flip `status` to `'liquidating'` (intermediate wind-down state).
 *   3. Issue the valuation proceeds to the business account (authority →
 *      business issuance, `valuation × (1 − HAIRCUT)`). The proceeds are new
 *      money from the external buyer.
 *   4. Settle outstanding liabilities from the business's cash + proceeds
 *      (business → authority sink, capped at the available pool). Limited
 *      liability: only the business's assets settle its debts, never the
 *      player's pre-existing personal cash.
 *   5. Credit the residue (remaining business cash) to `player:personal`
 *      (business → player transfer).
 *   6. Remove the business + its cash account (balance 0 after step 5).
 *   7. Emit `business-sold`.
 *
 * Conservation: the issuance (proceeds) + the sinks (settled liabilities)
 * + the transfer (residue → player) preserve
 * `sum(balances) + totalSinks === initialSupply + totalIssued`. The business
 * account is removed at balance 0.
 *
 * Pure: returns a new state, never mutates input. Deterministic given
 * (state, action).
 */
export const sellBusinessHandler: ActionListener<SellBusinessAction> = (
  state,
  action,
) => {
  const { businessId, tick } = action.payload;
  const business = requireBusiness(state, businessId);
  const definition = requireBusinessType(business.type);
  requireSupportedAction(definition, 'sell-business', businessId);

  const timestamp = tick;
  const saveId = state.metadata.saveId;
  const valuation = parseBusinessAmount(business.valuation, 'valuation');
  // proceeds = floor(valuation × (1 − HAIRCUT)). The haircut reflects the
  // illiquidity discount (TDD §11 — you cannot spend valuation directly;
  // liquidating converts it to cash at a loss).
  const proceeds = BigInt(
    Math.floor(Number(valuation) * (1 - PROVISIONAL_BUSINESS_VALUATION_HAIRCUT)),
  );
  const totalLiabilities = sumLiabilities(business);

  let next: GameState = state;

  // 1. Flip status to 'liquidating' on the business record.
  next = {
    ...next,
    businesses: next.businesses.map((b) =>
      b.id === businessId ? { ...b, status: 'liquidating' } : b,
    ),
  };

  // 2. Issue the proceeds to the business account (authority → business).
  if (proceeds > 0n) {
    next = transfer(next, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: businessId,
      amount: proceeds.toString(10),
      category: CATEGORY_BUSINESS_SALE,
      description: `Sale proceeds (valuation×(1−haircut)) for ${businessId}`,
      timestamp,
      requestId: `business-sale-proceeds:${saveId}:${timestamp}:${businessId}`,
    });
  }

  // 3. Settle liabilities from the business's pool (cash + proceeds).
  const pool = getBalance(next, businessId);
  const settledLiabilities =
    totalLiabilities <= pool ? totalLiabilities : pool;
  if (settledLiabilities > 0n) {
    next = transfer(next, {
      sourceAccount: businessId,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: settledLiabilities.toString(10),
      category: CATEGORY_BUSINESS_LOAN_REPAYMENT,
      description: `Settle liabilities on liquidation of ${businessId}`,
      timestamp,
      requestId: `business-sale-settle:${saveId}:${timestamp}:${businessId}`,
    });
  }

  // 4. Credit the residue to player:personal (business → player).
  const residue = getBalance(next, businessId);
  if (residue > 0n) {
    next = transfer(next, {
      sourceAccount: businessId,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: residue.toString(10),
      category: CATEGORY_BUSINESS_SALE,
      description: `Sale residue to owner for ${businessId}`,
      timestamp,
      requestId: `business-sale-residue:${saveId}:${timestamp}:${businessId}`,
    });
  }

  // Mirror the new player balance.
  const playerBalanceAfter = getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
  if (playerBalanceAfter.toString(10) !== next.player.personalCash) {
    next = {
      ...next,
      player: { ...next.player, personalCash: playerBalanceAfter.toString(10) },
    };
  }

  // 5. Remove the business + its cash account (balance is 0 after step 4).
  next = {
    ...next,
    businesses: next.businesses.filter((b) => b.id !== businessId),
    economy: {
      ...next.economy,
      accounts: next.economy.accounts.filter((a) => a.id !== businessId),
    },
  };

  const events: SimulationEvent[] = [
    {
      type: 'business-sold',
      at: timestamp,
      payload: {
        businessId,
        valuation: business.valuation,
        haircut: PROVISIONAL_BUSINESS_VALUATION_HAIRCUT,
        settledLiabilities: settledLiabilities.toString(10),
        proceeds: residue.toString(10),
        playerBalanceAfter: playerBalanceAfter.toString(10),
      },
    },
  ];

  return { state: next, events };
};

/**
 * `take-loan` action handler (P8b — GDD §8.4 debt and interest growth
 * pressure).
 *
 *   1. Find the business (content gate: `'take-loan'` supported).
 *   2. Append a Liability `{ id, type: 'loan', principal, interestRate,
 *      dueAt }` to `business.liabilities`.
 *   3. Credit the principal to the business's cash via an authority issuance
 *      (the loan is new money — the conservation invariant holds because the
 *      Liability offsets it on the balance sheet: assets − liabilities is
 *      unchanged by the issuance). Idempotent via the `requestId`.
 *   4. Emit `loan-taken`.
 *
 * Pure: returns a new state, never mutates input. Deterministic given
 * (state, action).
 */
export const takeLoanHandler: ActionListener<TakeLoanAction> = (state, action) => {
  const { businessId, principal, interestRate, dueAt, label } = action.payload;
  const business = requireBusiness(state, businessId);
  const definition = requireBusinessType(business.type);
  requireSupportedAction(definition, 'take-loan', businessId);

  const timestamp = state.clock.elapsedSeconds;
  const saveId = state.metadata.saveId;
  const liabilityId = `liability:${saveId}:${businessId}:${business.liabilities.length}`;
  const requestId = `business-loan:${saveId}:${timestamp}:${businessId}:${liabilityId}`;

  // Idempotency: a replayed loan (save/load mid-action) returns state
  // unchanged with no events.
  if (isRequestProcessed(state, requestId)) {
    return { state, events: [] };
  }

  // 1. Credit the principal to the business via an authority issuance.
  let next: GameState = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    destinationAccount: businessId,
    amount: principal,
    category: CATEGORY_BUSINESS_LOAN,
    description: label ?? `Loan principal issued to ${businessId}`,
    timestamp,
    requestId,
  });

  // 2. Append the Liability to the business.
  next = {
    ...next,
    businesses: next.businesses.map((b) =>
      b.id === businessId
        ? {
            ...b,
            liabilities: [
              ...b.liabilities,
              {
                id: liabilityId,
                type: 'loan',
                principal,
                interestRate,
                dueAt,
              },
            ],
          }
        : b,
    ),
  };

  // 3. Sync the business cash mirror.
  next = syncBusinessCash(next, businessId);

  const businessCashAfter = getBalance(next, businessId).toString(10);
  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: timestamp,
      payload: {
        record: next.economy.transactions[next.economy.transactions.length - 1]!,
      },
    },
    {
      type: 'loan-taken',
      at: timestamp,
      payload: {
        businessId,
        liabilityId,
        principal,
        interestRate,
        dueAt,
        businessCashAfter,
      },
    },
  ];

  return { state: next, events };
};

/**
 * `repay-loan` action handler (P8b — GDD §8.4).
 *
 *   1. Find the business + the liability (`UnknownLiabilityError` if the
 *      liability id is not on the business). Content gate: `'repay-loan'`.
 *   2. Cap the repayment at the outstanding principal (overpayment beyond
 *      the principal is silently capped — the action's `amount` is the
 *      requested amount; the actual repaid is `min(amount, principal)`).
 *   3. Debit the business (business → authority sink). The loan principal was
 *      issued money; repaying destroys it (mirrors P3c's expense sink).
 *   4. Reduce the liability principal; remove the liability if fully repaid.
 *   5. Emit `loan-repaid`.
 *
 * @provisional The interest/principal split: P8b's `accrueInterest` compounds
 * accrued interest into the principal (no separate interest-accrued field on
 * the Liability schema), so the repayment reduces the compounded principal.
 * The event's `interestPaid` is '0' and `principalPaid` is the repaid amount.
 * A future phase that splits interest-accrued-but-unpaid from principal will
 * populate `interestPaid` with the accrued portion paid first (per the
 * schema doc's "interest accrued to date is paid first, then principal").
 *
 * Pure: returns a new state, never mutates input.
 */
export const repayLoanHandler: ActionListener<RepayLoanAction> = (state, action) => {
  const { businessId, liabilityId, amount, tick } = action.payload;
  const business = requireBusiness(state, businessId);
  const definition = requireBusinessType(business.type);
  requireSupportedAction(definition, 'repay-loan', businessId);

  const liability = business.liabilities.find((l) => l.id === liabilityId);
  if (!liability) {
    throw new UnknownLiabilityError(businessId, liabilityId);
  }

  const timestamp = tick;
  const saveId = state.metadata.saveId;
  const outstanding = parseBusinessAmount(liability.principal, 'principal');
  const requested = parseAmount(amount, 'amount');
  // Cap at the outstanding principal.
  const repaid = requested <= outstanding ? requested : outstanding;
  const remainingPrincipal = outstanding - repaid;

  if (repaid > 0n) {
    state = transfer(state, {
      sourceAccount: businessId,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: repaid.toString(10),
      category: CATEGORY_BUSINESS_LOAN_REPAYMENT,
      description: `Repay loan ${liabilityId} on ${businessId}`,
      timestamp,
      requestId: `business-loan-repay:${saveId}:${timestamp}:${businessId}:${liabilityId}`,
    });
  }

  // Reduce / remove the liability.
  let next: GameState = {
    ...state,
    businesses: state.businesses.map((b) => {
      if (b.id !== businessId) return b;
      const newLiabilities =
        remainingPrincipal > 0n
          ? b.liabilities.map((l) =>
              l.id === liabilityId
                ? { ...l, principal: remainingPrincipal.toString(10) }
                : l,
            )
          : b.liabilities.filter((l) => l.id !== liabilityId);
      return { ...b, liabilities: newLiabilities };
    }),
  };

  next = syncBusinessCash(next, businessId);
  const businessCashAfter = getBalance(next, businessId).toString(10);

  const events: SimulationEvent[] = [];
  if (repaid > 0n) {
    events.push({
      type: 'transaction-recorded',
      at: timestamp,
      payload: {
        record: next.economy.transactions[next.economy.transactions.length - 1]!,
      },
    });
  }
  events.push({
    type: 'loan-repaid',
    at: timestamp,
    payload: {
      businessId,
      liabilityId,
      interestPaid: '0',
      principalPaid: repaid.toString(10),
      totalRepaid: repaid.toString(10),
      remainingPrincipal: remainingPrincipal.toString(10),
      businessCashAfter,
    },
  });

  return { state: next, events };
};

/**
 * `hire-employees` action handler (P8b — GDD §8.4 labor costs).
 *
 * Increments `business.employees` by `count`. Hiring raises production
 * capacity (the BusinessSystem scales output by
 * `PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY × employees`) but also the
 * wage bill. The handler does NOT pre-check solvency — the BusinessSystem
 * flips the business to `bankrupt` if wages push cash below the threshold.
 *
 * Pure: returns a new state, never mutates input.
 */
export const hireEmployeesHandler: ActionListener<HireEmployeesAction> = (
  state,
  action,
) => {
  const { businessId, count } = action.payload;
  const business = requireBusiness(state, businessId);
  const definition = requireBusinessType(business.type);
  requireSupportedAction(definition, 'hire-employees', businessId);

  const employeesAfter = business.employees + count;
  const next: GameState = {
    ...state,
    businesses: state.businesses.map((b) =>
      b.id === businessId ? { ...b, employees: employeesAfter } : b,
    ),
  };
  const events: SimulationEvent[] = [
    {
      type: 'employees-hired',
      at: state.clock.elapsedSeconds,
      payload: { businessId, count, employeesAfter },
    },
  ];
  return { state: next, events };
};

/**
 * `lay-off-employees` action handler (P8b — GDD §8.4).
 *
 * Decrements `business.employees` by `count`, clamped at 0 (cannot go
 * negative). The actual count laid off may be less than requested if the
 * request would drive the count below 0.
 *
 * @provisional No severance charge in P8b (deferred to P8c — GDD §17 labor
 * model).
 *
 * Pure: returns a new state, never mutates input.
 */
export const layOffEmployeesHandler: ActionListener<LayOffEmployeesAction> = (
  state,
  action,
) => {
  const { businessId, count } = action.payload;
  const business = requireBusiness(state, businessId);
  const definition = requireBusinessType(business.type);
  requireSupportedAction(definition, 'lay-off-employees', businessId);

  const actual = Math.min(count, business.employees);
  const employeesAfter = business.employees - actual;
  const next: GameState = {
    ...state,
    businesses: state.businesses.map((b) =>
      b.id === businessId ? { ...b, employees: employeesAfter } : b,
    ),
  };
  const events: SimulationEvent[] = [
    {
      type: 'employees-laid-off',
      at: state.clock.elapsedSeconds,
      payload: { businessId, count: actual, employeesAfter },
    },
  ];
  return { state: next, events };
};

/**
 * `set-business-status` action handler (P8b — TDD §5.7).
 *
 * Sets `business.status` to the requested value. Only `'operating'` and
 * `'idle'` are accepted via this action — `'bankrupt'` and `'liquidating'`
 * are system-internal transitions (the BusinessSystem flips to `'bankrupt'`
 * when cash crosses the bankruptcy threshold; `sell-business` flips to
 * `'liquidating'` during wind-down). Requesting either raises
 * `InvalidBusinessStatusError`.
 *
 * Idempotent — setting `status` to its current value is a no-op (no event
 * emitted), mirroring P6b2's enable/disable-automation idempotency.
 *
 * Pure: returns a new state, never mutates input.
 */
export const setBusinessStatusHandler: ActionListener<SetBusinessStatusAction> = (
  state,
  action,
) => {
  const { businessId, status } = action.payload;
  const business = requireBusiness(state, businessId);
  const definition = requireBusinessType(business.type);
  requireSupportedAction(definition, 'set-business-status', businessId);

  if (status === 'bankrupt' || status === 'liquidating') {
    throw new InvalidBusinessStatusError(businessId, status);
  }

  // Idempotent — already in the requested status.
  if (business.status === status) {
    return { state, events: [] };
  }

  const next: GameState = {
    ...state,
    businesses: state.businesses.map((b) =>
      b.id === businessId ? { ...b, status } : b,
    ),
  };
  const events: SimulationEvent[] = [
    {
      type: 'system',
      at: state.clock.elapsedSeconds,
      payload: {
        systemId: 'BusinessSystem',
        message: `Business "${businessId}" status set to ${status}.`,
        data: { businessId, status },
      },
    },
  ];
  return { state: next, events };
};

// Re-export the category constants for tests / audit.
export {
  CATEGORY_BUSINESS_PURCHASE,
  CATEGORY_BUSINESS_SALE,
  CATEGORY_BUSINESS_LOAN,
  CATEGORY_BUSINESS_LOAN_REPAYMENT,
};
