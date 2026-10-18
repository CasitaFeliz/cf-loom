import { keyOf, stringLiteralOf } from '../source-text/index.ts';

/**
 * An Open Enum's reader: a declared value as itself, any other string as its Unknown case,
 * `{ unknown: 'refunded' }`, so TypeScript tells them apart.
 */
export function openEnumReaderOf(declared: string): string {
  return `z.union([${declared}, z.string().transform((unknown) => ({ unknown }))])`;
}

/**
 * An Open Union's reader: a declared variant as itself, an object whose discriminator is a string
 * no variant declares as its Unknown case, `{ type: { unknown: 'crypto' }, raw }`, with `raw` the
 * object as received; a declared variant that breaks its schema is still refused.
 */
export function openUnionReaderOf(
  declared: string,
  discriminator: string,
  known: readonly unknown[],
): string {
  const key = keyOf(discriminator);
  const name = stringLiteralOf(discriminator);
  const values = known.map((value) => JSON.stringify(value)).join(', ');
  const isUnknown = `(value) => ![${values}].includes(value)`;
  const unknownVariant = `z.looseObject({ ${key}: z.string().refine(${isUnknown}) })`;
  const unknownCase = `(raw) => ({ ${key}: { unknown: raw[${name}] }, raw })`;
  return `z.union([${declared}, ${unknownVariant}.transform(${unknownCase})])`;
}
