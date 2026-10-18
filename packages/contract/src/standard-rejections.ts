import { freezeDeclaration } from './freeze-declaration.ts';
import type { RejectionStatus } from './http.ts';

/** The three Standard Rejections by name, as values, so the runtime resolves each. */
export const standardRejectionNames = ['invalidInput', 'notFound', 'notImplemented'] as const;

type StandardRejectionName = (typeof standardRejectionNames)[number];

/** The Standard Rejections cf-loom's runtime adds to every Endpoint, as values, so none lists them. */
export const addedStandardRejectionNames: readonly unknown[] = ['invalidInput', 'notImplemented'];

/** The Standard Rejections cf-loom's runtime adds to every Endpoint, so none lists them. */
export type AddedStandardRejectionName = 'invalidInput' | 'notImplemented';

/** A Rejection whose code, status and message the root resolves; no Contract declares one. */
export type StandardRejection<Name extends StandardRejectionName = StandardRejectionName> =
  Name extends StandardRejectionName
    ? { readonly kind: 'standard-rejection'; readonly name: Name }
    : never;

/** The Rejection cf-loom's runtime answers when the Input breaks the Endpoint's schemas. */
export const invalidInput: StandardRejection<'invalidInput'> = freezeDeclaration(
  'standard-rejection',
  {
    name: 'invalidInput',
  },
);

/** The Rejection an Endpoint lists, like any of its own, when it may answer that nothing exists. */
export const notFound: StandardRejection<'notFound'> = freezeDeclaration('standard-rejection', {
  name: 'notFound',
});

/** The Rejection cf-loom's runtime answers for a Handler that is still a stub. */
export const notImplemented: StandardRejection<'notImplemented'> = freezeDeclaration(
  'standard-rejection',
  {
    name: 'notImplemented',
  },
);

/** What a Definitions Package writes for one Standard Rejection: a code, a status and a message. */
export type StandardRejectionDeclaration<Status extends number = RejectionStatus> = {
  readonly code: string;
  readonly status: Status;
  readonly message: string;
};

/** What a Definitions Package may give each Standard Rejection: never a body, cf-loom's own. */
export type StandardRejectionDeclarations = {
  readonly invalidInput?: StandardRejectionDeclaration<RejectionStatus>;
  readonly notFound?: StandardRejectionDeclaration<RejectionStatus>;
  readonly notImplemented?: StandardRejectionDeclaration<501>;
};

/** Every Standard Rejection resolved, as a Contract Package carries them for its Callers. */
export type StandardRejections = Required<StandardRejectionDeclarations>;
