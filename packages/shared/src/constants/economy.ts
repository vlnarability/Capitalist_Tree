/**
 * Economy provisional constants (P3 — TDD §10, GDD §6).
 *
 * Every value here corresponds to (or stands in for) an unresolved design
 * decision listed in GDD §17 (currency issuance mechanics, monetary policy,
 * inflation model). They live in a dedicated file so economy tuning is
 * localized to one place. The simulation engine imports these via
 * `@capitalist-tree/shared` — never use magic numbers inside the EconomySystem.
 *
 * CONVENTION: `PROVISIONAL_ECONOMY_*` prefix and a `// PROVISIONAL (GDD §17:
 * <item>)` comment pointing at the GDD entry the value resolves. When a
 * value is promoted from "provisional" to "decided" via playtesting, move it
 * to a sibling `decided.ts` and remove the prefix.
 */

// PROVISIONAL (GDD §6.2 / §17: currency issuance mechanics and monetary policy)
//
// Account id of the central monetary authority. The authority is the virtual
// "mint" — it is the source of newly issued currency and the sink for currency
// removed from circulation (taxes, fees, central-bank interventions).
//
// The authority does NOT have an entry in `economy.accounts` — its net
// position is implied by `totalIssued - totalSinks`. Transactions involving
// the authority use this string as `sourceAccount` (issuance) or
// `destinationAccount` (sink).
export const PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID = 'authority';

// PROVISIONAL (GDD §8.1 / §17: personal vs business finances)
//
// Account id of the player's personal cash account. Personal and business
// finances MUST remain separate (GDD §8.1) — this is the personal-cash
// account only. P3c may add business accounts (e.g. `business:<id>:cash`).
export const PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID = 'player:personal';

// PROVISIONAL (GDD §17: currency issuance mechanics)
//
// Default external-participants account. Markets and external suppliers
// transact through this account. P3b will populate per-market accounts.
export const PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID = 'external:default';

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Human-readable labels for the default accounts. The UI may override these
// with localized strings; these are the canonical fallbacks.
export const PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_LABEL = 'Player Personal';
export const PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_LABEL = 'External Participants';

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Maximum currency (minor units, bigint-as-string) that may be issued per
// single CurrencyIssuanceRequest. `null` means no per-request cap. P3a
// defaults to uncapped so we can validate the ledger plumbing end-to-end;
// P3c+ may set a cap as a monetary-policy lever.
export const PROVISIONAL_ECONOMY_ISSUANCE_MAX_PER_REQUEST_MINOR: string | null = null;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Maximum cumulative currency issuance across all requests. `null` means no
// cumulative cap. P3a defaults to uncapped.
export const PROVISIONAL_ECONOMY_ISSUANCE_MAX_TOTAL_MINOR: string | null = null;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Fraction of each issued amount that is immediately sunk (removed from
// circulation) as an issuance fee, in [0, 1]. 0 = no fee (P3a default). A
// non-zero value would record a separate `fee` transaction sinking the fee
// portion back to the authority — keeping the conservation invariant intact.
// P3a does NOT honour this field yet (no fee transactions); the hook exists
// so P3c can wire it without changing the schema.
export const PROVISIONAL_ECONOMY_ISSUANCE_FEE_FRACTION = 0;

// Transaction category constants — short machine codes used in the
// `category` field of TransactionRecord. These are NOT Zod enums (yet) so
// P3b/c can add new categories without a schema migration. They are the
// canonical strings the engine emits; consumers may switch on them.
export const PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE = 'issuance';
export const PROVISIONAL_ECONOMY_CATEGORY_SINK = 'sink';
export const PROVISIONAL_ECONOMY_CATEGORY_TRANSFER = 'transfer';
export const PROVISIONAL_ECONOMY_CATEGORY_PURCHASE = 'purchase';
export const PROVISIONAL_ECONOMY_CATEGORY_EXPENSE = 'expense';
export const PROVISIONAL_ECONOMY_CATEGORY_TAX = 'tax';
export const PROVISIONAL_ECONOMY_CATEGORY_FEE = 'fee';
