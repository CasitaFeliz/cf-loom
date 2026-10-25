import type { Issue } from '@cf-loom/contract';
import {
  type AnswerableRejection,
  type Checked,
  headerTextsOf,
  rejectionBodyReaderOf,
  rejectionResponseOf,
  resolutionOf,
  successFieldsOf,
  successResponseOf,
  writtenPartOf,
} from '@cf-loom/contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import { type ListedEndpoint, whoOf } from '../provided/index.ts';
import type { Answer } from '../scripting/index.ts';

/**
 * A scripted Success as `serve` sends it: its headers and body written as its readers read them,
 * then its headers as text; what breaks the readers, or cannot travel, is the test's mistake.
 */
export function scriptedSuccessResponseOf(scripted: unknown, listed: ListedEndpoint): Response {
  const { endpoint } = listed;
  const given = successFieldsOf(endpoint, scripted);
  const headers = writtenPartOf('success.headers', endpoint.success.headers, {
    value: given['headers'],
  });
  const body = writtenPartOf('success.body', endpoint.success.body, { value: given['body'] });
  const sentHeaders = fieldsOf(checkedValueOf(headers));
  const texts = headerTextsOf('success.headers', sentHeaders);
  const textIssues = texts.kind === 'issues' ? texts.issues : [];
  const issues = [...issuesOf(headers), ...issuesOf(body), ...textIssues];
  if (issues.length > 0) {
    const what = 'the scripted Success breaks its readers';
    throw mistakeOf({ ...whoOf(listed), what, issues });
  }
  const sent = {
    status: endpoint.success.status,
    headers: sentHeaders,
    body: checkedValueOf(body),
  };
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
  const body = writtenPartOf('body', reader, { value: declared.body });
  if (body.kind === 'issues') {
    const what = `the scripted ${declared.code} body breaks its reader`;
    throw mistakeOf({ ...whoOf(listed), what, issues: body.issues });
  }
  const resolved = resolutionOf(declared.rejection, listed.standards);
  const message = declared.message ?? resolved.message;
  return rejectionResponseOf({ ...resolved, message, body: body.value });
}

function checkedValueOf(checked: Checked): unknown {
  return checked.kind === 'value' ? checked.value : undefined;
}

function issuesOf(checked: Checked): readonly Issue[] {
  return checked.kind === 'issues' ? checked.issues : [];
}

function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}
