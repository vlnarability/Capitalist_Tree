/**
 * Tests for `lib/format/money.ts` (P5b).
 *
 * Covers:
 *   - `formatMoney` formats bigint minor units to `$X.XX` with grouping.
 *   - Negative values get a leading `-`.
 *   - Cents are always two digits (`5n` → `$0.05`).
 *   - Custom symbol override.
 *   - `formatMoneyFromStr` parses the bigint-as-string used on `personalCash`,
 *     `account.balance`, `market.price`. Malformed strings fall back to
 *     `$0.00` rather than throwing.
 *   - `formatSignedMoney` always shows `+` / `-`.
 *   - `sumMinorStrings` totals an array of bigint-as-strings.
 */
import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatMoneyFromStr,
  formatSignedMoney,
  sumMinorStrings,
} from '../../../lib/format/money';

describe('formatMoney — bigint minor units → $X.XX', () => {
  it('formats 0n as $0.00', () => {
    expect(formatMoney(0n)).toBe('$0.00');
  });

  it('formats 1n as $0.01 (single cent)', () => {
    expect(formatMoney(1n)).toBe('$0.01');
  });

  it('formats 5n as $0.05 (cents pad to two digits)', () => {
    expect(formatMoney(5n)).toBe('$0.05');
  });

  it('formats 100n as $1.00', () => {
    expect(formatMoney(100n)).toBe('$1.00');
  });

  it('formats 123456n as $1,234.56 (thousands grouping)', () => {
    expect(formatMoney(123456n)).toBe('$1,234.56');
  });

  it('formats 50000n as $500.00 (starting cash)', () => {
    expect(formatMoney(50000n)).toBe('$500.00');
  });

  it('formats negative values with a leading minus', () => {
    expect(formatMoney(-12345n)).toBe('-$123.45');
  });

  it('formats large values with grouping', () => {
    expect(formatMoney(1_000_000_000n)).toBe('$10,000,000.00');
  });

  it('accepts a custom currency symbol', () => {
    expect(formatMoney(12345n, '€')).toBe('€123.45');
    expect(formatMoney(0n, '◈')).toBe('◈0.00');
  });
});

describe('formatMoneyFromStr — bigint-as-string → $X.XX', () => {
  it('formats "50000" as $500.00 (player starting cash)', () => {
    expect(formatMoneyFromStr('50000')).toBe('$500.00');
  });

  it('formats "0" as $0.00', () => {
    expect(formatMoneyFromStr('0')).toBe('$0.00');
  });

  it('formats "123456" as $1,234.56', () => {
    expect(formatMoneyFromStr('123456')).toBe('$1,234.56');
  });

  it('handles negative strings', () => {
    expect(formatMoneyFromStr('-500')).toBe('-$5.00');
  });

  it('falls back to $0.00 on malformed string (no throw)', () => {
    expect(formatMoneyFromStr('')).toBe('$0.00');
    expect(formatMoneyFromStr('abc')).toBe('$0.00');
    expect(formatMoneyFromStr('1.5')).toBe('$0.00'); // no decimals allowed
    expect(formatMoneyFromStr('1e3')).toBe('$0.00'); // no scientific notation
    // Leading/trailing whitespace is tolerated.
    expect(formatMoneyFromStr('  100  ')).toBe('$1.00');
  });

  it('accepts a custom currency symbol', () => {
    expect(formatMoneyFromStr('100', '€')).toBe('€1.00');
  });
});

describe('formatSignedMoney — always shows sign', () => {
  it('shows + for positive values', () => {
    expect(formatSignedMoney(12345n)).toBe('+$123.45');
  });

  it('shows - for negative values', () => {
    expect(formatSignedMoney(-12345n)).toBe('-$123.45');
  });

  it('shows + for zero (so layout does not shift on zero)', () => {
    expect(formatSignedMoney(0n)).toBe('+$0.00');
  });

  it('accepts a custom currency symbol', () => {
    expect(formatSignedMoney(100n, '◈')).toBe('+◈1.00');
    expect(formatSignedMoney(-100n, '◈')).toBe('-◈1.00');
  });
});

describe('sumMinorStrings — bigint-as-string total', () => {
  it('sums a list of bigint-as-strings', () => {
    expect(sumMinorStrings(['100', '200', '50'])).toBe(350n);
  });

  it('returns 0n for an empty array', () => {
    expect(sumMinorStrings([])).toBe(0n);
  });

  it('skips malformed entries (contributes 0n)', () => {
    expect(sumMinorStrings(['100', '', 'abc', '200'])).toBe(300n);
  });

  it('handles negative entries', () => {
    expect(sumMinorStrings(['500', '-200', '50'])).toBe(350n);
  });

  it('totals all five living-expense categories cleanly', () => {
    // Mirrors PlayerState.livingExpenses shape: {food, housing, utilities,
    // healthcare, transportation}, all bigint minor units as string.
    const expenses = {
      food: '12000',
      housing: '35000',
      utilities: '8000',
      healthcare: '5000',
      transportation: '6000',
    };
    const total = sumMinorStrings(Object.values(expenses));
    expect(total).toBe(66_000n); // $660.00 monthly total
    expect(formatMoney(total)).toBe('$660.00');
  });
});
