/** The Callers this fictional Service knows, by their API key; a real one reads them from a secret store. */
const callerIdByKey: ReadonlyMap<string, string> = new Map([['billing-key', 'billing-service']]);

/** The Caller an API key belongs to, if any; no key belongs to no Caller. */
export function callerIdOf(key: string | undefined): string | undefined {
  return key === undefined ? undefined : callerIdByKey.get(key);
}
