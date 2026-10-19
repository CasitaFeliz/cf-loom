/**
 * An Open Enum's reader: a declared value as itself, any other string as its Unknown case,
 * `{ unknown: 'refunded' }`, so TypeScript tells them apart.
 */
export function openEnumReaderOf(declared: string): string {
  return `z.union([${declared}, z.string().transform((unknown) => ({ unknown }))])`;
}
