/**
 * Where the tools get the complete list of a scope's packages, since npm-compatible registries
 * cannot list a scope; an organization may write its own.
 */
export type ContractDirectory = {
  /** Every package in the scope, or why they cannot all be listed: never a partial list. */
  readonly list: () => Promise<Listed>;
};

/**
 * What listing a Contract directory ends with: the npm name of every package in the scope, in no
 * particular order, or one line saying why the list is not complete.
 */
export type Listed =
  | { readonly kind: 'listed'; readonly names: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };
