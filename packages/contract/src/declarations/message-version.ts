/** Whether a value is a Message Version's version: a whole number from 1. */
export function isMessageVersion(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= 1;
}
