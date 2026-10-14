/**
 * Precise integer money arithmetic (Rules 106–112).
 *
 * Every amount is an integer number of minor units (cents/paisas) paired with
 * an explicit ISO 4217 currency code. No floating-point math touches a balance —
 * `19.99` never becomes `19.989999999999998`.
 */
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const CENTS_PER_UNIT = 100;

const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  PKR: 'Rs',
};

/** Raised for any operation that would silently lose monetary precision. */
export class MoneyPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyPrecisionError';
    Object.setPrototypeOf(this, MoneyPrecisionError.prototype);
  }
}

/** Narrow a string to a supported ISO 4217 currency, else throw. */
export function assertCurrency(currency: string): asserts currency is SupportedCurrency {
  const wellFormed = /^[A-Z]{3}$/.test(currency);
  const supported = (SUPPORTED_CURRENCIES as readonly string[]).includes(currency);
  if (!wellFormed || !supported) {
    throw new MoneyPrecisionError(
      `Unsupported currency "${currency}". Supported ISO 4217 codes: ${SUPPORTED_CURRENCIES.join(', ')}.`,
    );
  }
}

/** Ensure an amount is a safe integer count of minor units (rejects NaN/Infinity/floats). */
export function assertIntegerCents(amountCents: number, label = 'amountCents'): void {
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents)) {
    throw new MoneyPrecisionError(
      `${label} must be a safe integer number of minor units (cents); received ${String(amountCents)}.`,
    );
  }
}

/**
 * Parse a decimal string ("1299.99") into integer cents (129999) using string
 * maths only — never `Number(x) * 100`, which drifts on values like "19.99".
 */
export function decimalStringToCents(decimalStr: string): number {
  if (typeof decimalStr !== 'string') {
    throw new MoneyPrecisionError(`Expected a decimal string, received ${typeof decimalStr}.`);
  }
  const s = decimalStr.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new MoneyPrecisionError(
      `Invalid monetary string "${decimalStr}". Expected e.g. "1299.99" with at most 2 decimal places.`,
    );
  }
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole) * CENTS_PER_UNIT + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyPrecisionError(`Monetary string "${decimalStr}" is out of safe integer range.`);
  }
  return negative ? -cents : cents;
}

/** Render integer cents as a fixed 2-decimal string ("129999" -> "1299.99"). */
export function centsToDecimalString(amountCents: number): string {
  assertIntegerCents(amountCents);
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);
  const whole = Math.floor(abs / CENTS_PER_UNIT);
  const frac = abs % CENTS_PER_UNIT;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

/**
 * Format cents for display with an explicit ISO code, e.g.
 * `USD $1,299.99`, `PKR Rs 1,450,000.00`, `USD -$340.00`.
 */
export function formatMoney(amountCents: number, currency: string): string {
  assertIntegerCents(amountCents);
  assertCurrency(currency);
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);
  const whole = Math.floor(abs / CENTS_PER_UNIT).toLocaleString('en-US');
  const frac = String(abs % CENTS_PER_UNIT).padStart(2, '0');
  const symbol = CURRENCY_SYMBOLS[currency];
  const symbolGap = symbol.length > 1 ? ' ' : ''; // "Rs 1,450,000.00" vs "$1,299.99"
  return `${currency} ${negative ? '-' : ''}${symbol}${symbolGap}${whole}.${frac}`;
}

/** Add two amounts of the same currency; throws on currency mismatch. */
export function addMoney(
  aCents: number,
  bCents: number,
  currencyA: string,
  currencyB: string,
): number {
  assertIntegerCents(aCents, 'aCents');
  assertIntegerCents(bCents, 'bCents');
  assertCurrency(currencyA);
  assertCurrency(currencyB);
  if (currencyA !== currencyB) {
    throw new MoneyPrecisionError(`Cannot add ${currencyA} to ${currencyB}; currencies must match.`);
  }
  const result = aCents + bCents;
  if (!Number.isSafeInteger(result)) {
    throw new MoneyPrecisionError('Money addition overflowed the safe integer range.');
  }
  return result;
}

/** Subtract `b` from `a` (same currency); throws on currency mismatch. */
export function subtractMoney(
  aCents: number,
  bCents: number,
  currencyA: string,
  currencyB: string,
): number {
  assertIntegerCents(aCents, 'aCents');
  assertIntegerCents(bCents, 'bCents');
  assertCurrency(currencyA);
  assertCurrency(currencyB);
  if (currencyA !== currencyB) {
    throw new MoneyPrecisionError(
      `Cannot subtract ${currencyB} from ${currencyA}; currencies must match.`,
    );
  }
  const result = aCents - bCents;
  if (!Number.isSafeInteger(result)) {
    throw new MoneyPrecisionError('Money subtraction overflowed the safe integer range.');
  }
  return result;
}

/** Line total = integer quantity × integer unit amount. */
export function calculateLineTotalCents(quantity: number, unitAmountCents: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyPrecisionError(
      `quantity must be a non-negative safe integer; received ${String(quantity)}.`,
    );
  }
  assertIntegerCents(unitAmountCents, 'unitAmountCents');
  if (unitAmountCents < 0) {
    throw new MoneyPrecisionError('unitAmountCents must be >= 0.');
  }
  const total = quantity * unitAmountCents;
  if (!Number.isSafeInteger(total)) {
    throw new MoneyPrecisionError('Line total overflowed the safe integer range.');
  }
  return total;
}

/** Tax from basis points (10000 bps = 100%) with exact half-up integer rounding. */
export function calculateTaxCents(subtotalCents: number, taxRateBps: number): number {
  assertIntegerCents(subtotalCents, 'subtotalCents');
  if (subtotalCents < 0) throw new MoneyPrecisionError('subtotalCents must be >= 0.');
  if (!Number.isSafeInteger(taxRateBps) || taxRateBps < 0) {
    throw new MoneyPrecisionError(
      `taxRateBps must be a non-negative safe integer; received ${String(taxRateBps)}.`,
    );
  }
  return Math.round((subtotalCents * taxRateBps) / 10000);
}

/** Gross margin in basis points (2540 = 25.40%); returns 0 when price is 0. */
export function calculateGrossMarginBps(
  unitCostCents: number,
  sellingPriceCents: number,
): number {
  assertIntegerCents(unitCostCents, 'unitCostCents');
  assertIntegerCents(sellingPriceCents, 'sellingPriceCents');
  if (unitCostCents < 0 || sellingPriceCents < 0) {
    throw new MoneyPrecisionError('unitCostCents and sellingPriceCents must be >= 0.');
  }
  if (sellingPriceCents === 0) return 0;
  return Math.round(((sellingPriceCents - unitCostCents) / sellingPriceCents) * 10000);
}
