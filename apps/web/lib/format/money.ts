/**
 * Money formatting helpers (P5b — GDD §13.1 main screen, §13.2 simplified view).
 *
 * Pure functions that convert the simulation's bigint minor-units representation
 * (TDD §10.1) into the human-readable strings shown on the dashboard:
 *
 *   - `formatMoney(minor)` — `$X.XX` (two decimals, locale-aware grouping).
 *   - `formatMoneyFromStr(minorStr)` — convenience wrapper that accepts the
 *     bigint-as-string stored on `PlayerState.personalCash` /
 *     `AccountState.balance` / `MarketState.price` / etc.
 *   - `formatSignedMoney(minor)` — `+$X.XX` / `-$X.XX` for transaction /
 *     expense summaries where the sign carries meaning.
 *
 * Why pure + in `lib/format/`?
 *   - Rule 6 (rendering / UI reads state, never writes): these helpers read
 *     the bigint, format a string, and return it. They never call into the
 *     engine, never mutate inputs, never read the DOM.
 *   - The simulation stores money as bigint minor units to avoid float
 *     drift (TDD §10.1). The UI converts to a display string at the boundary
 *     — `lib/format/money.ts` is that boundary.
 *   - Kept separate from `lib/format/tree.ts` + `lib/format/weather.ts` so
 *     each domain has its own file (matches P5b's split).
 *
 * The helpers never throw on bad input — a malformed string yields `'$0.00'`
 * so a transient bad value never takes down the dashboard. The engine's
 * schema validation is the authoritative gate; the UI degrades gracefully
 * past it.
 */

/**
 * Format a bigint minor-units value as a currency string.
 *
 * The output always carries a sign for negative values (`-$X.XX`) and never
 * for non-negative (`$X.XX`). Two decimal places, with thousands grouping for
 * readability (e.g. `$1,234.56`). The grouping uses `Intl.NumberFormat` so
 * the separators match the runtime locale (`,` in en-US, `.` in most of
 * Europe, etc.) — keeps the dashboard readable across locales.
 *
 * @param minor — bigint amount in minor currency units (e.g. `123456n` → `$1,234.56`).
 * @param symbol — currency symbol to prepend. Defaults to `'$'`. Cosmetic
 *   only — the sim's `currencyId` is the authoritative currency id; this
 *   symbol is just the human-readable prefix shown in the dashboard.
 */
export function formatMoney(minor: bigint, symbol: string = '$'): string {
  const negative = minor < 0n;
  const absMinor = negative ? -minor : minor;
  // Whole-dollars + cents split. BigInt division truncates; the remainder is
  // the cents portion. We pad the cents to exactly two digits so `$0.05`
  // prints correctly (not `$0.5`).
  const whole = absMinor / 100n;
  const cents = absMinor % 100n;
  const wholeStr = formatWholeGrouping(whole);
  const centsStr = cents.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${symbol}${wholeStr}.${centsStr}`;
}

/**
 * Format a bigint-as-string minor-units value as a currency string.
 *
 * Accepts the string form stored on the simulation's state fields (e.g.
 * `player.personalCash`, `account.balance`, `market.price`). Defensive:
 * returns `'$0.00'` (with the chosen symbol) if the string is empty or
 * malformed — a transient bad value should not crash the dashboard.
 *
 * @param minorStr — bigint minor units serialized as a string of digits
 *   (optionally prefixed with `-` for negative). Accepts arbitrary leading
 *   whitespace; rejects anything that isn't a valid integer literal by
 *   falling back to `0n`.
 * @param symbol — currency symbol to prepend. Defaults to `'$'`.
 */
export function formatMoneyFromStr(minorStr: string, symbol: string = '$'): string {
  return formatMoney(parseMinorUnits(minorStr), symbol);
}

/**
 * Format a signed amount — always shows `+` or `-` so the sign carries
 * meaning in transaction / expense summaries. Useful for "spent" lines
 * where a positive number means an outflow.
 *
 * @param minor — bigint amount. Positive → `+$X.XX`; negative → `-$X.XX`;
 *   zero → `+$0.00` (so the layout doesn't shift on a zero value).
 * @param symbol — currency symbol to prepend. Defaults to `'$'`.
 */
export function formatSignedMoney(minor: bigint, symbol: string = '$'): string {
  const sign = minor < 0n ? '-' : '+';
  return `${sign}${formatMoney(minor < 0n ? -minor : minor, symbol)}`;
}

/**
 * Sum an array of bigint-as-string minor-unit values, returning the total
 * as a bigint. Empty / malformed entries contribute `0n`. Used by the
 * expenses summary to total all five living-expense categories.
 */
export function sumMinorStrings(values: readonly string[]): bigint {
  return values.reduce<bigint>((acc, v) => acc + parseMinorUnits(v), 0n);
}

// ----------------------------------------------------------------------------
// Internal helpers.
// ----------------------------------------------------------------------------

const INTEGER_LITERAL_RE = /^\s*-?\d+\s*$/;

/**
 * Parse a bigint-as-string minor-units value defensively. Returns `0n` for
 * anything that isn't a clean integer literal (with optional leading `-`).
 */
function parseMinorUnits(s: string): bigint {
  if (typeof s !== 'string' || !INTEGER_LITERAL_RE.test(s)) return 0n;
  try {
    return BigInt(s.trim());
  } catch {
    return 0n;
  }
}

/**
 * Format a non-negative bigint whole-units value with thousands grouping
 * (e.g. `1234n` → `"1,234"`). Uses `Intl.NumberFormat` so the separator
 * matches the runtime locale. Zero is `"0"`.
 */
function formatWholeGrouping(whole: bigint): string {
  if (whole === 0n) return '0';
  // Intl.NumberFormat handles the grouping via the runtime locale.
  // BigInt support was added in Node 17 / modern browsers — we already
  // target ES2022 so this is safe.
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(whole);
  } catch {
    // Defensive fallback if Intl isn't available (extremely unlikely in any
    // environment that runs a Next.js app). Slow path — just groups every
    // three digits from the right with `,`.
    const digits = whole.toString();
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}
