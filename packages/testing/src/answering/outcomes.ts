import type { Issue } from '@cf-loom/contract';
import {
  type AnswerableRejection,
  encodedValueOf,
  headerTextsOf,
  type IssuePart,
  type Parsed,
  rejectionBodyReaderOf,
  rejectionResponseOf,
  resolutionOf,
  successResponseOf,
} from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import { mistakeOf } from '../mistakes/index.ts';
import { type ListedEndpoint, whoOf } from '../provided/index.ts';
import type { Answer } from '../scripting/index.ts';

/**
 * A scripted Success as `serve` sends it: its headers and body written as its readers read them,
 * then its headers as text; what breaks the readers, or cannot travel, is the test's mistake.
 */
export function scriptedSuccessResponseOf(scripted: unknown, listed: ListedEndpoint): Response {
  const { success } = listed.endpoint;
  const given = success.headers === undefined ? { body: scripted } : fieldsOf(scripted);
  const headers = writtenOf('success.headers', success.headers, given['headers']);
  const body = writtenOf('success.body', success.body, given['body']);
  const texts = headerTextsOf('success.headers', fieldsOf(headers.value));
  const textIssues = texts.kind === 'issues' ? texts.issues : [];
  const issues = [...headers.issues, ...body.issues, ...textIssues];
  if (issues.length > 0) {
    const what = 'the scripted Success breaks its readers';
    throw mistakeOf({ ...whoOf(listed), what, issues });
  }
  const sent = { status: success.status, headers: fieldsOf(headers.value), body: body.value };
  return successResponseOf(sent);
}

type KnownRejection = Extract<Answer, { readonly kind: 'rejection' }>;

/** A Rejection by a code the Endpoint answers, as `serve` sends it. */
export function knownRejectionResponseOf(answer: KnownRejection, listed: ListedEndpoint): Response {
  const rejection = listed.rejectionsByCode.get(answer.code);
  if (rejection === undefined) {
    const sends = "r.unknownRejection sends a code the Provider's Contract does not declare";
    const what = `the Endpoint answers no code ${answer.code}; ${sends}`;
    throw mistakeOf({ ...whoOf(listed), what });
  }
  return declaredRejectionResponseOf({ ...answer, rejection }, listed);
}

/** A Rejection the Provider declares, as scripted: its message, when one replaces the declared one, and its body. */
export type DeclaredAnswer = {
  readonly code: string;
  readonly rejection: AnswerableRejection;
  readonly message?: string;
  readonly body?: unknown;
};

/**
 * A Rejection the Provider declares, as `serve` sends it: its resolved code and status, its
 * message unless one is given, and its body written as its reader reads it.
 */
export function declaredRejectionResponseOf(
  declared: DeclaredAnswer,
  listed: ListedEndpoint,
): Response {
  const reader = rejectionBodyReaderOf(declared.rejection, listed.standards);
  const body = writtenOf('body', reader, declared.body);
  if (body.issues.length > 0) {
    const what = `the scripted ${declared.code} body breaks its reader`;
    throw mistakeOf({ ...whoOf(listed), what, issues: body.issues });
  }
  const resolved = resolutionOf(declared.rejection, listed.standards);
  const message = declared.message ?? resolved.message;
  return rejectionResponseOf({ ...resolved, message, body: body.value });
}

/** A part as written for its reader, or every Issue at that part; nothing where none is declared. */
type Written = { readonly value: unknown; readonly issues: readonly Issue[] };

function writtenOf(part: IssuePart, reader: core.$ZodType | undefined, given: unknown): Written {
  if (reader === undefined) {
    return { value: undefined, issues: [] };
  }
  const encoded: Parsed = encodedValueOf(reader, given);
  if (encoded.kind === 'issues') {
    return { value: undefined, issues: encoded.issues.map((issue) => ({ part, ...issue })) };
  }
  return { value: encoded.value, issues: [] };
}

function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}
