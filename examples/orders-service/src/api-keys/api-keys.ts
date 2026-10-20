/** The Callers this fictional Service knows, by their API key; a real one reads them from a secret store. */
const clientIdByKey: ReadonlyMap<string, string> = new Map([['billing-key', 'billing-service']]);

/** The Caller an API key belongs to, if any. */
export function clientIdOf(key: string): string | undefined {
  return clientIdByKey.get(key);
}
