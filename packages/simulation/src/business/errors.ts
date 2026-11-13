/**
 * Typed errors for the business module (P8b — TDD §5.7 / §11, GDD §8).
 *
 * Each error is a real `class` so callers can use `instanceof` for routing
 * (e.g. the UI surfaces "unknown business type" as a toast without crashing
 * the engine). The BusinessSystem itself never throws for graceful failure
 * conditions (idle / bankrupt / insufficient-inputs / insufficient-funds /
 * no-employees) — those are converted into `business-operated` events with
 * `operated: false` + a `reason` code (mirrors P6b2's `automation-skipped`
 * pattern). These errors are for *programmer* mistakes: an action referencing
 * a business / business-type / liability id that does not exist, an
 * unsupported action for a business type, or an invalid status transition.
 *
 * The errors are NOT part of the saved GameState — they are runtime-only
 * signals, mirroring the economy module's `economy/errors.ts` + the
 * automation module's `automation/errors.ts` pattern. They live here (not in
 * `@capitalist-tree/shared`) because P8a froze the shared error surface
 * (`packages/shared/` is read-only per the P8b task contract); P8b stays in
 * the simulation package.
 *
 * @provisional — a future phase that promotes business errors to the shared
 * package (so the web app imports them from `@capitalist-tree/shared`) would
 * move these classes verbatim. The `name` strings are part of the public
 * interface — do NOT rename.
 */
import type { BusinessStatus } from '@capitalist-tree/shared';

/**
 * A `purchase-business` action referenced an unknown `businessTypeId` — no
 * BusinessTypeDefinition with that id is registered in
 * `packages/content/src/businesses/`. Thrown rather than silently no-op'ing
 * so the caller gets a clear signal (and a UI can avoid offering the option
 * until the type is registered).
 */
export class UnknownBusinessTypeError extends Error {
  readonly businessTypeId: string;

  constructor(businessTypeId: string) {
    super(
      `Unknown business type "${businessTypeId}". Register the type in ` +
        `packages/content/src/businesses/ (getBusinessTypeById).`,
    );
    this.name = 'UnknownBusinessTypeError';
    this.businessTypeId = businessTypeId;
  }
}

/**
 * An action referenced a `businessId` not in `state.businesses`. Thrown by
 * every business action handler that targets an existing business
 * (operate-business / sell-business / take-loan / repay-loan /
 * hire-employees / lay-off-employees / set-business-status). Mirrors
 * `UnknownAutomationError`.
 */
export class UnknownBusinessError extends Error {
  readonly businessId: string;

  constructor(businessId: string) {
    super(
      `Unknown business "${businessId}". Instantiate it via the ` +
        `purchase-business action before referencing it.`,
    );
    this.name = 'UnknownBusinessError';
    this.businessId = businessId;
  }
}

/**
 * The business type's `supportedActions` does not include the dispatched
 * action's `type` (content gate — `businessSupportedActionSchema`). Thrown so
 * the caller gets a clear signal that the action would have no defined effect
 * for this business type (e.g. a `take-loan` against a business type whose
 * `supportedActions` omits it). Mirrors `UnsupportedPolicyError`.
 */
export class UnsupportedBusinessActionError extends Error {
  readonly businessId: string;
  readonly actionType: string;
  readonly supportedActions: readonly string[];

  constructor(
    businessId: string,
    actionType: string,
    supportedActions: readonly string[],
  ) {
    super(
      `Unsupported action "${actionType}" for business "${businessId}": ` +
        `the business type's supportedActions [${supportedActions.join(', ')}] ` +
        `does not include it.`,
    );
    this.name = 'UnsupportedBusinessActionError';
    this.businessId = businessId;
    this.actionType = actionType;
    this.supportedActions = supportedActions;
  }
}

/**
 * A `repay-loan` action referenced a `liabilityId` not in
 * `business.liabilities`. Thrown so the caller gets a clear signal — a
 * silent no-op would hide a stale UI referencing a settled loan.
 */
export class UnknownLiabilityError extends Error {
  readonly businessId: string;
  readonly liabilityId: string;

  constructor(businessId: string, liabilityId: string) {
    super(
      `Unknown liability "${liabilityId}" on business "${businessId}". ` +
        `The liability may have been fully repaid + removed, or never existed.`,
    );
    this.name = 'UnknownLiabilityError';
    this.businessId = businessId;
    this.liabilityId = liabilityId;
  }
}

/**
 * A `set-business-status` action requested `bankrupt` or `liquidating` —
 * those transitions are system-internal (the BusinessSystem flips to
 * `bankrupt` when cash crosses
 * `PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD`; `sell-business` flips to
 * `liquidating` during wind-down). Only `operating` and `idle` are accepted
 * via the action. Thrown so the caller gets a clear signal rather than the
 * engine silently ignoring an illegal transition.
 */
export class InvalidBusinessStatusError extends Error {
  readonly businessId: string;
  readonly requestedStatus: BusinessStatus;

  constructor(businessId: string, requestedStatus: BusinessStatus) {
    super(
      `Invalid status "${requestedStatus}" for business "${businessId}" via ` +
        `set-business-status: only 'operating' and 'idle' are accepted. ` +
        `'bankrupt' and 'liquidating' are system-internal transitions.`,
    );
    this.name = 'InvalidBusinessStatusError';
    this.businessId = businessId;
    this.requestedStatus = requestedStatus;
  }
}
