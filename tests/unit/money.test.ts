import { describe, expect, it } from 'vitest';
import {
  addMoney,
  assertCurrency,
  assertIntegerCents,
  calculateGrossMarginBps,
  calculateLineTotalCents,
  calculateTaxCents,
  centsToDecimalString,
  decimalStringToCents,
  formatMoney,
  MoneyPrecisionError,
  SUPPORTED_CURRENCIES,
  subtractMoney,
} from '../../src/lib/money';

describe('assertCurrency', () => {
  it('accepts every supported ISO 4217 code', () => {
    for (const c of SUPPORTED_CURRENCIES) expect(() => assertCurrency(c)).not.toThrow();
  });

  it('rejects lowercase, wrong length, and unsupported codes', () => {
    for (const bad of ['usd', 'US', 'USDX', 'JPY', '', '12$']) {
      expect(() => assertCurrency(bad)).toThrow(MoneyPrecisionError);
    }
  });
});

describe('assertIntegerCents', () => {
  it('accepts safe integers (including negatives and zero)', () => {
    for (const ok of [0, 1, -1, 129999, -34000, Number.MAX_SAFE_INTEGER]) {
      expect(() => assertIntegerCents(ok)).not.toThrow();
    }
  });

  it('rejects NaN, Infinity, floats and non-numbers', () => {
    for (const bad of [NaN, Infinity, -Infinity, 19.99, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertIntegerCents(bad)).toThrow(MoneyPrecisionError);
    }
  });
});

describe('decimalStringToCents', () => {
  it('parses without float drift', () => {
    expect(decimalStringToCents('1299.99')).toBe(129999);
    expect(decimalStringToCents('0')).toBe(0);
    expect(decimalStringToCents('0.05')).toBe(5);
    expect(decimalStringToCents('0.5')).toBe(50);
    expect(decimalStringToCents('1.5')).toBe(150);
    expect(decimalStringToCents('-340')).toBe(-34000);
    expect(decimalStringToCents('  42.00 ')).toBe(4200);
    // The classic float trap: 19.99 * 100 === 1998.9999999999998
    expect(decimalStringToCents('19.99')).toBe(1999);
    expect(decimalStringToCents('1450000.00')).toBe(145000000);
  });

  it('rejects >2 decimals and malformed input', () => {
    for (const bad of ['1.234', 'abc', '', '$1.00', '1.', '.5', '1,000', '1e3', '--1']) {
      expect(() => decimalStringToCents(bad)).toThrow(MoneyPrecisionError);
    }
  });
});

describe('centsToDecimalString', () => {
  it('renders fixed 2-decimal strings', () => {
    expect(centsToDecimalString(129999)).toBe('1299.99');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(50)).toBe('0.50');
    expect(centsToDecimalString(-34000)).toBe('-340.00');
    expect(centsToDecimalString(0)).toBe('0.00');
    expect(centsToDecimalString(145000000)).toBe('1450000.00');
  });
});

describe('formatMoney', () => {
  it('prefixes the ISO code + symbol and handles negatives', () => {
    expect(formatMoney(129999, 'USD')).toBe('USD $1,299.99');
    expect(formatMoney(145000000, 'PKR')).toBe('PKR Rs 1,450,000.00');
    expect(formatMoney(-34000, 'USD')).toBe('USD -$340.00');
    expect(formatMoney(0, 'EUR')).toBe('EUR €0.00');
    expect(formatMoney(1234567, 'GBP')).toBe('GBP £12,345.67');
  });

  it('rejects unsupported currency and non-integer cents', () => {
    expect(() => formatMoney(1, 'JPY')).toThrow(MoneyPrecisionError);
    expect(() => formatMoney(1.5, 'USD')).toThrow(MoneyPrecisionError);
  });
});

describe('addMoney / subtractMoney', () => {
  it('adds and subtracts same-currency amounts', () => {
    expect(addMoney(129999, 1, 'USD', 'USD')).toBe(130000);
    expect(subtractMoney(130000, 1, 'USD', 'USD')).toBe(129999);
    expect(subtractMoney(100, 250, 'GBP', 'GBP')).toBe(-150);
  });

  it('throws on currency mismatch', () => {
    expect(() => addMoney(1, 1, 'USD', 'EUR')).toThrow(MoneyPrecisionError);
    expect(() => subtractMoney(1, 1, 'PKR', 'GBP')).toThrow(MoneyPrecisionError);
  });
});

describe('calculateLineTotalCents', () => {
  it('multiplies integer quantity by integer unit amount', () => {
    expect(calculateLineTotalCents(3, 45000)).toBe(135000);
    expect(calculateLineTotalCents(0, 45000)).toBe(0);
  });

  it('rejects negative or non-integer quantity', () => {
    expect(() => calculateLineTotalCents(-1, 100)).toThrow(MoneyPrecisionError);
    expect(() => calculateLineTotalCents(1.5, 100)).toThrow(MoneyPrecisionError);
  });
});

describe('calculateTaxCents', () => {
  it('applies basis-point rounding half-up', () => {
    expect(calculateTaxCents(10000, 1000)).toBe(1000); // 10% of $100.00
    expect(calculateTaxCents(129999, 825)).toBe(10725); // 8.25% -> 10724.9175 -> 10725
    expect(calculateTaxCents(1, 5000)).toBe(1); // 0.5 -> rounds half up to 1
    expect(calculateTaxCents(1, 4999)).toBe(0); // 0.4999 -> 0
    expect(calculateTaxCents(0, 2000)).toBe(0);
  });
});

describe('calculateGrossMarginBps', () => {
  it('returns basis-point margin', () => {
    expect(calculateGrossMarginBps(750, 1000)).toBe(2500); // 25.00%
    expect(calculateGrossMarginBps(0, 1000)).toBe(10000); // 100.00%
  });

  it('returns 0 when selling price is 0', () => {
    expect(calculateGrossMarginBps(500, 0)).toBe(0);
  });
});

describe('randomized integer-cent invariants (1,000 iterations)', () => {
  it('never loses precision across round-trips and add/subtract', () => {
    const currencies = SUPPORTED_CURRENCIES;
    for (let i = 0; i < 1000; i++) {
      const cents = Math.floor(Math.random() * 200_000_000) - 100_000_000;
      const currency = currencies[i % currencies.length];

      // Format -> parse round trip is exact.
      expect(decimalStringToCents(centsToDecimalString(cents))).toBe(cents);

      // add then subtract is the identity.
      const b = Math.floor(Math.random() * 10_000_000);
      const sum = addMoney(cents, b, currency, currency);
      expect(subtractMoney(sum, b, currency, currency)).toBe(cents);

      // line total == repeated addition.
      const qty = Math.floor(Math.random() * 50);
      const unit = Math.floor(Math.random() * 1_000_000);
      let naive = 0;
      for (let k = 0; k < qty; k++) naive = addMoney(naive, unit, currency, currency);
      expect(calculateLineTotalCents(qty, unit)).toBe(naive);

      // tax stays within [0, subtotal] for sane rates.
      const subtotal = Math.abs(cents);
      const tax = calculateTaxCents(subtotal, Math.floor(Math.random() * 3000));
      expect(tax).toBeGreaterThanOrEqual(0);
      expect(tax).toBeLessThanOrEqual(subtotal);
    }
  });
});
