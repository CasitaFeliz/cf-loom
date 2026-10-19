/** The codes cf-loom answers outside the Contract, as Faults, as values; no declaration may take one. */
export const reservedCodes = [
  'RETIRED',
  'NO_SUCH_ENDPOINT',
  'BODY_TOO_LARGE',
  'INVALID_OUTCOME',
] as const;

/** A code cf-loom answers outside the Contract, as a Fault. */
export type ReservedCode = (typeof reservedCodes)[number];
