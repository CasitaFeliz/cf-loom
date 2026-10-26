/** An instant as a `deprecatedAt` is written: ISO 8601 in UTC, to the second. */
export function stampOf(instant: number): string {
  return new Date(instant).toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Whether an instant lies in the range a `Date`, and so a stamp, can hold. */
export function isStampable(instant: number): boolean {
  return !Number.isNaN(new Date(instant).getTime());
}

/** Whether a value is an instant written as `stampOf` writes one: it reads back as itself. */
export function isStamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) {
    return false;
  }
  const instant = Date.parse(value);
  return !Number.isNaN(instant) && stampOf(instant) === value;
}
