import { type DecimalDigits, decimalDigitsOf } from '../walker/index.ts';

/**
 * Whether a number is an exact multiple of a divisor on the digits JavaScript writes them with, so
 * `0.3` is a multiple of `0.1` and `0.05` of `0.01`, which floating-point division cannot tell.
 */
export function isMultipleOf(value: number, divisor: number): boolean {
  const dividend = decimalDigitsOf(value);
  const step = decimalDigitsOf(divisor);
  const exponent = Math.min(dividend.exponent, step.exponent);
  const scaledDividend = scaledTo(exponent, dividend);
  const scaledStep = scaledTo(exponent, step);
  return scaledStep === 0n ? scaledDividend === 0n : scaledDividend % scaledStep === 0n;
}

function scaledTo(exponent: number, { digits, exponent: own }: DecimalDigits): bigint {
  return BigInt(digits) * 10n ** BigInt(own - exponent);
}
