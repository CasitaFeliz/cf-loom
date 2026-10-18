import { keyOf, stringLiteralOf } from '../source-text/index.ts';

/**
 * An Open Enum's reader: a declared value as itself, any other string as its Unknown case,
 * `{ unknown: 'refunded' }`, so TypeScript tells them apart.
 */
export function openEnumReaderOf(declared: string): string {
  return `z.union([${declared}, z.string().transform((unknown) => ({ unknown }))])`;
}

/**
 * An Open Union's reader: a declared variant as itself, and an object whose discriminator is a
 * string no variant declares as its Unknown case, `{ type: { unknown: 'crypto' }, raw }`.
 */
export function openUnionReaderOf(
  declared: string,
  discriminator: string,
  knownValues: readonly string[],
): string {
  return `z.union([${declared}, ${unknownVariantOf(discriminator, knownValues)}])`;
}

/**
 * The Unknown case of an Open Union, refusing a declared value so a declared variant that breaks
 * its schema is still refused; `raw` is the object as received.
 */
function unknownVariantOf(discriminator: string, knownValues: readonly string[]): string {
  const key = keyOf(discriminator);
  const isUnknown = `(value) => ![${knownValues.join(', ')}].includes(value)`;
  const unknownCase = `(raw) => ({ ${key}: { unknown: raw[${stringLiteralOf(discriminator)}] }, raw })`;
  return `z.looseObject({ ${key}: z.string().refine(${isUnknown}) }).transform(${unknownCase})`;
}
