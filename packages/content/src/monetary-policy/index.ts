/**
 * Monetary issuance policy (TDD §10.3, GDD §6.2).
 *
 * The monetary authority applies this policy when deciding whether to fulfil
 * a CurrencyIssuanceRequest emitted by `harvest-leaves`. P3a ships a
 * permissive default — no caps, no fees — so we can validate the ledger
 * plumbing end-to-end before introducing monetary levers. P3c+ may introduce:
 *
 *   - per-request issuance caps (a single harvest can't mint a trillion
 *     dollars from one leaf),
 *   - cumulative issuance caps (the money supply can't exceed a ceiling),
 *   - issuance fees (a fraction of the issued amount is sunk to the
 *     authority as a "minting fee"),
 *   - per-tree caps (a sapling issues at a discount),
 *   - dynamic policy (interest-rate-driven issuance limits, business-cycle
 *     interventions).
 *
 * The policy is DATA — the engine reads it via the content package and never
 * hardcodes limits (rule 5: content is data). All values are @provisional
 * per GDD §17 ("currency issuance mechanics and monetary policy").
 */
import type { CurrencyIssuanceRequest } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ECONOMY_ISSUANCE_MAX_PER_REQUEST_MINOR,
  PROVISIONAL_ECONOMY_ISSUANCE_MAX_TOTAL_MINOR,
  PROVISIONAL_ECONOMY_ISSUANCE_FEE_FRACTION,
} from '@capitalist-tree/shared';

/**
 * Issuance policy (TDD §10.3).
 *
 * `maxPerRequest` and `maxTotal` are bigint-as-string for safe JSON
 * round-trip (TDD §10.1). `null` means no cap. `issuanceFeeFraction` is a
 * plain number in [0, 1] (it's a ratio, not money).
 */
export interface IssuancePolicy {
  /** Unique id for this policy version. Bump when tunable values change. */
  id: string;
  /**
   * Maximum amount (minor units, bigint-as-string) that may be issued per
   * single CurrencyIssuanceRequest. `null` means no per-request cap.
   */
  maxPerRequest: string | null;
  /**
   * Maximum cumulative amount (minor units, bigint-as-string) that may be
   * issued across all requests. `null` means no cumulative cap.
   */
  maxTotal: string | null;
  /**
   * Fraction of each issued amount that is immediately sunk (removed from
   * circulation) as an issuance fee, in [0, 1]. 0 = no fee. The fee is
   * recorded as a separate `fee` transaction. P3a does NOT honour this field
   * yet (no fee transactions); the hook exists so P3c can wire it without a
   * schema change.
   */
  issuanceFeeFraction: number;
}

/**
 * Default issuance policy (P3a).
 *
 * Permissive: no per-request cap, no cumulative cap, no issuance fee. This
 * validates the ledger + transaction + idempotency plumbing before any
 * monetary-policy levers are introduced.
 *
 * PROVISIONAL: GDD §17 — "currency issuance mechanics and monetary policy".
 */
export const DEFAULT_ISSUANCE_POLICY: IssuancePolicy = {
  id: 'issuance-policy:default-v1',
  maxPerRequest: PROVISIONAL_ECONOMY_ISSUANCE_MAX_PER_REQUEST_MINOR,
  maxTotal: PROVISIONAL_ECONOMY_ISSUANCE_MAX_TOTAL_MINOR,
  issuanceFeeFraction: PROVISIONAL_ECONOMY_ISSUANCE_FEE_FRACTION,
};

/**
 * Authorization result for a pending issuance. Pure — does NOT mutate state.
 * The EconomySystem reads the result and either credits the destination
 * (authorized) or emits a rejection event (not authorized).
 */
export interface IssuanceAuthorization {
  authorized: boolean;
  /** Short machine code: 'invalid-amount' | 'per-request-limit-exceeded' | 'cumulative-limit-exceeded'. */
  reason?: string;
  /** Human-readable message for the UI. */
  message?: string;
}

/**
 * Check whether a pending issuance is authorized under the policy. Pure.
 *
 * Inputs:
 *   - `policy`: the IssuancePolicy to apply.
 *   - `request`: the CurrencyIssuanceRequest to authorize.
 *   - `ctx.totalIssued`: cumulative currency already issued (bigint string).
 *
 * Returns `{ authorized: true }` if the request fits within all caps.
 * Otherwise returns `{ authorized: false, reason, message }`.
 *
 * Note: this function does NOT check the idempotency set — that's the
 * caller's responsibility (the EconomySystem checks `processedRequestIds`
 * before calling this). It only checks the policy's caps.
 */
export function authorizeIssuance(
  policy: IssuancePolicy,
  request: CurrencyIssuanceRequest,
  ctx: {
    totalIssued: string;
  },
): IssuanceAuthorization {
  // Validate amount parses as a positive bigint. (The EconomySystem also
  // validates this, but the policy check is the cleaner place to surface
  // the rejection reason.)
  let amount: bigint;
  try {
    amount = BigInt(request.amount);
  } catch {
    return {
      authorized: false,
      reason: 'invalid-amount',
      message: `Issuance amount "${request.amount}" is not a valid bigint string.`,
    };
  }
  if (amount <= 0n) {
    return {
      authorized: false,
      reason: 'invalid-amount',
      message: `Issuance amount must be > 0 (got ${request.amount}).`,
    };
  }

  if (policy.maxPerRequest !== null) {
    if (amount > BigInt(policy.maxPerRequest)) {
      return {
        authorized: false,
        reason: 'per-request-limit-exceeded',
        message: `Issuance amount ${request.amount} exceeds per-request cap ${policy.maxPerRequest}.`,
      };
    }
  }

  if (policy.maxTotal !== null) {
    const total = BigInt(ctx.totalIssued);
    if (total + amount > BigInt(policy.maxTotal)) {
      return {
        authorized: false,
        reason: 'cumulative-limit-exceeded',
        message: `Issuance would push total issued ${total + amount} beyond cap ${policy.maxTotal}.`,
      };
    }
  }

  return { authorized: true };
}
