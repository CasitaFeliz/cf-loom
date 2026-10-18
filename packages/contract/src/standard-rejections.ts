import type { RejectionStatus } from './http.ts';

type StandardRejectionName = 'invalidInput' | 'notFound' | 'notImplemented';

/** One of the three Rejections whose code, status and message are resolved from the root, never declared by a Contract. */
export type StandardRejection<Name extends StandardRejectionName = StandardRejectionName> = {
  readonly kind: 'standard-rejection';
  readonly name: Name;
};

/** The Rejection cf-loom's runtime answers when the Input breaks the Endpoint's schemas. */
export const invalidInput: StandardRejection<'invalidInput'> = Object.freeze({
  kind: 'standard-rejection',
  name: 'invalidInput',
});

/** The Rejection an Endpoint lists, like any of its own, when it may answer that nothing was found. */
export const notFound: StandardRejection<'notFound'> = Object.freeze({
  kind: 'standard-rejection',
  name: 'notFound',
});

/** The Rejection cf-loom's runtime answers for a Handler that is still a stub. */
export const notImplemented: StandardRejection<'notImplemented'> = Object.freeze({
  kind: 'standard-rejection',
  name: 'notImplemented',
});

type StandardRejectionDeclaration<Status extends number> = {
  readonly code: string;
  readonly status: Status;
  readonly message: string;
  readonly body?: never;
};

/** What a Definitions Package may give each Standard Rejection: never a body, which is cf-loom's. */
export type StandardRejectionDeclarations = {
  readonly invalidInput?: StandardRejectionDeclaration<RejectionStatus>;
  readonly notFound?: StandardRejectionDeclaration<RejectionStatus>;
  readonly notImplemented?: StandardRejectionDeclaration<501>;
};

/** Every Standard Rejection resolved, as a Contract Package carries them for its Callers. */
export type StandardRejections = Required<StandardRejectionDeclarations>;
