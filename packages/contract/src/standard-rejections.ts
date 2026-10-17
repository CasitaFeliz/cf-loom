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

type Resolved<Status extends number> = {
  readonly code: string;
  readonly status: Status;
  readonly message: string;
};

/** The code, status and message a Definitions Package may give each Standard Rejection; none has a body to declare. */
export type StandardRejectionDeclarations = {
  readonly invalidInput?: Resolved<RejectionStatus>;
  readonly notFound?: Resolved<RejectionStatus>;
  readonly notImplemented?: Resolved<501>;
};

/** Every Standard Rejection resolved, as a Contract Package carries them for its Callers. */
export type StandardRejections = Required<StandardRejectionDeclarations>;
