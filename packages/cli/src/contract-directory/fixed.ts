import type { ContractDirectory } from './contract-directory.ts';

/** A Contract directory that lists the names it is given, copied when it is called, for tests. */
export function fixed(names: readonly string[]): ContractDirectory {
  const listed = [...names];
  return { list: async () => ({ kind: 'listed', names: [...listed] }) };
}
