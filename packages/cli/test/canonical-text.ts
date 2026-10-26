/** The keys a Snapshot starts with, in the order SNAPSHOT.md gives them. */
const headingKeys = ['format', 'kind', 'name', 'version', 'generator'];

/** A value with every object's keys sorted by code point, as the canonical form writes them. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const keys = Object.keys(value).sort();
  return Object.fromEntries(keys.map((key) => [key, sortedKeys(Reflect.get(value, key))]));
}

/**
 * A Snapshot as SNAPSHOT.md writes it to a file: the heading first, the other keys and every
 * nested key by code point, two-space indentation and a final newline.
 */
export function canonicalTextOf(snapshot: Readonly<Record<string, unknown>>): string {
  const sorted = sortedKeys(snapshot) as Record<string, unknown>;
  const heading = headingKeys.filter((key) => key in sorted);
  const rest = Object.keys(sorted).filter((key) => !headingKeys.includes(key));
  const ordered = Object.fromEntries([...heading, ...rest].map((key) => [key, sorted[key]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
