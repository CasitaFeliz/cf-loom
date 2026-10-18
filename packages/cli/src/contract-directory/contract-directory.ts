/** What a Contract directory answers: every Contract Package in the scope, or why it cannot. */
export type ContractDirectoryListing =
  | { readonly kind: 'listed'; readonly packages: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Where the tools get the complete list of a scope's Contract Packages, since npm-compatible
 * registries cannot list a scope; it returns the whole list or fails, never a partial one.
 */
export type ContractDirectory = {
  readonly list: (scope: string) => Promise<ContractDirectoryListing>;
};
