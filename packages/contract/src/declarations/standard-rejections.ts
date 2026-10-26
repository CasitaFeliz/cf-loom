import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { openEnum } from '../open/index.ts';
import { freezeDeclaration } from './freeze-declaration.ts';
import { notImplementedStatus, type RejectionStatus } from './http.ts';

/** The three Standard Rejections by name, as values, so the runtime resolves each. */
export const standardRejectionNames = ['invalidInput', 'notFound', 'notImplemented'] as const;

/** One of the three Standard Rejections, by name. */
export type StandardRejectionName = (typeof standardRejectionNames)[number];

/** The Standard Rejections cf-loom's runtime adds to every Endpoint, as values, so none lists them. */
export const addedStandardRejectionNames = ['invalidInput', 'notImplemented'] as const;

/** The Standard Rejections cf-loom's runtime adds to every Endpoint, so none lists them. */
export type AddedStandardRejectionName = (typeof addedStandardRejectionNames)[number];

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

/** The Rejection cf-loom's runtime answers for a Handler that is still a Stub. */
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
  readonly notImplemented?: StandardRejectionDeclaration<typeof notImplementedStatus>;
};

/** Every Standard Rejection resolved: its code, status and message. */
export type StandardRejections = Required<StandardRejectionDeclarations>;

/**
 * Every Standard Rejection as a Contract Package carries it for its Callers: resolved, and the
 * invalid-input one with the Reader schema of its body, generated from the Provider's Snapshot.
 */
export type ProvidedStandardRejections = StandardRejections & {
  readonly invalidInput: StandardRejectionDeclaration & { readonly body: core.$ZodType };
};

/** cf-loom's own code, status and message of each Standard Rejection, where no Definitions Package declares one. */
export const standardRejectionDefaults: StandardRejections = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: {
    code: 'NOT_IMPLEMENTED',
    status: notImplementedStatus,
    message: 'Not implemented',
  },
};

/** What an issue of invalid Input says went wrong: a set cf-loom owns, never zod's codes. */
export const issueCodes = [
  'required',
  'invalid_type',
  'invalid_value',
  'invalid_format',
  'too_small',
  'too_big',
  'not_multiple',
  'unrecognized_key',
  'malformed',
] as const;

/** What an issue says went wrong: a code of the set cf-loom owns, never zod's. */
export type IssueCode = (typeof issueCodes)[number];

/** The parts of a request an issue of invalid Input may sit in, as values. */
export const inputIns = ['params', 'query', 'headers', 'body'] as const;

/**
 * The body of the invalid-input Rejection: always cf-loom's, whatever a Definitions Package
 * declares, so every Caller reads the issues one way. An issue never carries the received value.
 */
export const invalidInputBody = z.object({
  issues: z.array(
    z.object({
      in: openEnum(inputIns),
      path: z.array(z.union([z.string(), z.number()])),
      code: openEnum(issueCodes),
      message: z.string(),
    }),
  ),
});
