/** A length of time as limits write it: a whole number from 1 and one unit, `500ms`, `30s`, `2m`, `1h` or `7d`. */
export type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;

/** How a refusal names what a duration must be. */
export const durationText = 'a duration such as 500ms, 30s, 2m, 1h or 7d';

const millisecondsInUnit = new Map([
  ['ms', 1n],
  ['s', 1_000n],
  ['m', 60_000n],
  ['h', 3_600_000n],
  ['d', 86_400_000n],
]);

/** The exact milliseconds of a duration text, unbounded; each adapter bounds them and converts them to its unit. */
export function millisecondsOf(input: unknown): bigint | undefined {
  const match = typeof input === 'string' ? /^([1-9]\d*)(ms|s|m|h|d)$/.exec(input) : null;
  const [, count = '', unit = ''] = match ?? [];
  const unitMilliseconds = millisecondsInUnit.get(unit);
  return unitMilliseconds === undefined ? undefined : BigInt(count) * unitMilliseconds;
}
