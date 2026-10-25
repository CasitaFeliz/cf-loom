import { byCodePoint } from '../walker/index.ts';

/** The names a module exports `value` under, by identity, `default` included, in code point order: the first is the one that wins. */
export function exportNamesOf(
  moduleExports: Readonly<Record<string, unknown>>,
  value: unknown,
): readonly string[] {
  const names = Object.keys(moduleExports).filter((name) => moduleExports[name] === value);
  return names.sort(byCodePoint);
}
