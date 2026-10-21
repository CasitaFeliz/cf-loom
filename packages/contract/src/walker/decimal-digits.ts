/**
 * A finite number as JavaScript's shortest round-trip text writes it, the sign apart: it equals
 * `digits × 10 ** exponent`, and `digits` may start with zeros.
 */
export type DecimalDigits = {
  readonly isNegative: boolean;
  readonly digits: string;
  readonly exponent: number;
};

const writtenNumber = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

/** The digits and the power of ten of a finite number, an exponent form's `e` taken apart. */
export function decimalDigitsOf(value: number): DecimalDigits {
  const written = writtenNumber.exec(String(Math.abs(value)));
  if (written === null) {
    throw new Error(`${value} is no finite number, and no Contract value can be one`);
  }
  const [, whole = '', fraction = '', power = '0'] = written;
  return {
    isNegative: value < 0,
    digits: whole + fraction,
    exponent: Number(power) - fraction.length,
  };
}
