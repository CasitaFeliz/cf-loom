import {
  type AnswerableRejection,
  rejectionResponseOf,
  rejectionShapeOf,
  resolutionOf,
  shapeFieldsOf,
  successResponseOf,
  successShapeOf,
  writtenShapeOf,
} from '@cf-loom/contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import { type ListedEndpoint, whoOf } from '../provided/index.ts';
import type { Answer } from '../scripting/index.ts';

/**
 * A scripted Success as `serve` sends it: its headers and body written as its readers read them,
 * its headers then as text; what breaks the readers, or cannot travel, is the test's mistake.
 */
export function scriptedSuccessResponseOf(scripted: unknown, listed: ListedEndpoint): Response {
  const { endpoint } = listed;
  const shape = successShapeOf(endpoint);
  const written = writtenShapeOf(shape, shapeFieldsOf(shape, scripted));
  if (written.kind === 'issues') {
    const what = 'the scripted Success breaks its readers';
    throw mistakeOf({ ...whoOf(listed), what, issues: written.issues });
  }
  return successResponseOf({ status: endpoint.success.status, ...written.value });
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
  const shape = rejectionShapeOf(rejection, listed.standards);
  const { headers, body } = shapeFieldsOf(shape, answer.given);
  return declaredRejectionResponseOf({ code: answer.code, rejection, headers, body }, listed);
}

/** A Rejection the Provider declares, as scripted: its message, when one replaces the declared one, its headers and its body. */
export type DeclaredAnswer = {
  readonly code: string;
  readonly rejection: AnswerableRejection;
  readonly message?: string;
  readonly headers?: unknown;
  readonly body?: unknown;
};

/**
 * A Rejection the Provider declares, as `serve` sends it: its resolved code and status, its
 * message unless one is given, and its headers and body written as their readers read them.
 */
export function declaredRejectionResponseOf(
  declared: DeclaredAnswer,
  listed: ListedEndpoint,
): Response {
  const shape = rejectionShapeOf(declared.rejection, listed.standards);
  const written = writtenShapeOf(shape, { headers: declared.headers, body: declared.body });
  if (written.kind === 'issues') {
    const what = `the scripted ${declared.code} breaks its readers`;
    throw mistakeOf({ ...whoOf(listed), what, issues: written.issues });
  }
  const resolved = resolutionOf(declared.rejection, listed.standards);
  const message = declared.message ?? resolved.message;
  return rejectionResponseOf({ ...resolved, message, ...written.value });
}
