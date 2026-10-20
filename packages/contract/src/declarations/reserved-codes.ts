/** The codes cf-loom answers outside the Contract, as Faults, as values; no declaration may take one. */
export const reservedCodes = [
  'RETIRED',
  'NO_SUCH_ENDPOINT',
  'BODY_TOO_LARGE',
  'INVALID_OUTCOME',
] as const;

/** A code cf-loom answers outside the Contract, as a Fault. */
export type ReservedCode = (typeof reservedCodes)[number];

/** Whether a value is a code cf-loom answers outside the Contract. */
export function isReservedCode(code: unknown): code is ReservedCode {
  return reservedCodes.some((reserved) => reserved === code);
}
