import type { Issue } from '@cf-loom/contract';
import {
  type AnswerableRejection,
  headerValuesOf,
  type ObjectNode,
  parseValue,
  type RejectionEnvelope,
  rejectionBodyReaderOf,
  rejectionHeadersReaderOf,
} from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type Arrival, type DecodedOutcome, invalidOutcomeOf, issuesAt } from './outcomes.ts';

/** A part of a Rejection as read: whether its code declares it, its value, and what broke it. */
type RejectionRead = {
  readonly declared: boolean;
  readonly value: unknown;
  readonly issues: readonly Issue[];
};

const notDeclared: RejectionRead = { declared: false, value: undefined, issues: [] };

/**
 * A Rejection Envelope as the Caller receives it: a code the Endpoint answers, with its headers
 * and body read by its Reader schemas and none where it declares none, or a code it does not know.
 */
export function rejectionOf(
  envelope: RejectionEnvelope['rejection'],
  arrival: Arrival,
  called: CalledEndpoint,
): DecodedOutcome {
  const { status, source } = arrival;
  const { code, message, body } = envelope;
  const rejection = called.rejectionsByCode.get(code);
  if (rejection === undefined) {
    const unknown = {
      kind: 'unknown-rejection',
      source: 'provider',
      code,
      status,
      message,
    } as const;
    return body === undefined ? unknown : { ...unknown, body };
  }
  const headers = headersReadOf(rejection, arrival.headers, called.rejectionHeaders.get(code));
  const read = bodyReadOf(rejection, body, called);
  const issues = [...headers.issues, ...read.issues];
  if (issues.length > 0) {
    return invalidOutcomeOf({ status, committed: 'unknown', issues });
  }
  const known = { kind: 'rejection', source, code, status, message } as const;
  return {
    ...known,
    ...(headers.declared ? { headers: headers.value } : {}),
    ...(read.declared ? { body: read.value } : {}),
  };
}

/** The headers a Rejection's code declares: each text converted by its node, then read with its Reader schema. */
function headersReadOf(
  rejection: AnswerableRejection,
  received: Headers,
  node: ObjectNode | undefined,
): RejectionRead {
  const schema = rejectionHeadersReaderOf(rejection);
  if (schema === undefined || node === undefined) {
    return notDeclared;
  }
  return readWith({ part: 'headers', schema }, headerValuesOf(node, received));
}

/** The body a Rejection's code declares, read with its Reader schema. */
function bodyReadOf(
  rejection: AnswerableRejection,
  body: unknown,
  called: CalledEndpoint,
): RejectionRead {
  const schema = rejectionBodyReaderOf(rejection, called.standards);
  return schema === undefined ? notDeclared : readWith({ part: 'body', schema }, body);
}

function readWith(
  { part, schema }: { readonly part: Issue['part']; readonly schema: core.$ZodType },
  value: unknown,
): RejectionRead {
  const parsed = parseValue(schema, value);
  const read = parsed.kind === 'value' ? parsed.value : undefined;
  return { declared: true, value: read, issues: issuesAt(part, parsed) };
}
