import { isPlainObject } from '../written/index.ts';

/**
 * The keys of a Qualifier that its schema's parse dropped, as dotted paths: `parsed` is what zod
 * made of `value`, and a walked schema transforms nothing, so only the stripped keys differ.
 */
export function strippedKeysOf(value: unknown, parsed: unknown): readonly string[] {
  return strippedKeys(value, parsed, []);
}

function strippedKeys(
  value: unknown,
  parsed: unknown,
  path: readonly (string | number)[],
): readonly string[] {
  if (Array.isArray(value) && Array.isArray(parsed)) {
    return value.flatMap((item, index) => strippedKeys(item, parsed[index], [...path, index]));
  }
  if (!isPlainObject(value) || !isPlainObject(parsed)) {
    return [];
  }
  const stripped: string[] = [];
  for (const [key, member] of Object.entries(value)) {
    const keyPath = [...path, key];
    if (Object.hasOwn(parsed, key)) {
      stripped.push(...strippedKeys(member, parsed[key], keyPath));
    } else {
      stripped.push(keyPath.join('.'));
    }
  }
  return stripped;
}
