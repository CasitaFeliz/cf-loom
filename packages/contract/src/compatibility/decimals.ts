/** A number as the digits and the power of ten JavaScript writes it with: `digits × 10 ** exponent`. */
type Decimal = { readonly digits: bigint; readonly exponent: number };

const writtenNumber = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

/**
 * Whether a number is an exact multiple of a divisor on the digits JavaScript writes them with, so
 * `0.3` is a multiple of `0.1` and `0.05` of `0.01`, which floating-point division cannot tell.
 */
export function isMultipleOf(value: number, divisor: number): boolean {
  const dividend = decimalOf(value);
  const step = decimalOf(divisor);
  const exponent = Math.min(dividend.exponent, step.exponent);
  const scaledDividend = scaledTo(exponent, dividend);
  const scaledStep = scaledTo(exponent, step);
  return scaledStep === 0n ? scaledDividend === 0n : scaledDividend % scaledStep === 0n;
}

function decimalOf(value: number): Decimal {
  const written = writtenNumber.exec(String(Math.abs(value)));
  if (written === null) {
    throw new Error(`The number ${value} has no decimal digits: it is not finite.`);
  }
  const [, whole = '', fraction = '', power = '0'] = written;
  return { digits: BigInt(whole + fraction), exponent: Number(power) - fraction.length };
}

function scaledTo(exponent: number, decimal: Decimal): bigint {
  return decimal.digits * 10n ** BigInt(decimal.exponent - exponent);
}
