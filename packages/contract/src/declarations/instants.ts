/** An instant as a `deprecatedAt` is written: ISO 8601 in UTC, to the second. */
export function instantTextOf(instant: number): string {
  return new Date(instant).toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Whether an instant lies in the range a `Date`, and so its text, can hold. */
export function isInstantInRange(instant: number): boolean {
  return !Number.isNaN(new Date(instant).getTime());
}

/** Whether a value is the text of an instant in UTC to the second, as `instantTextOf` writes one: it reads back as itself. */
export function isUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) {
    return false;
  }
  const instant = Date.parse(value);
  return !Number.isNaN(instant) && instantTextOf(instant) === value;
}
