/**
 * Where the tools get the complete list of a scope's Contract Packages, since npm-compatible
 * registries cannot list a scope. Opaque until the directories are designed, so `directory` in
 * the configuration names one without fixing its shape.
 */
export type ContractDirectory = { readonly kind: 'contract-directory' };
