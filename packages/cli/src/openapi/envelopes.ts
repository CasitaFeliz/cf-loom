import { byCodePoint, committedValues, reservedFaults } from '@cf-loom/contract/internal';
import { componentRefOf, definedOf, type JsonSchema, jsonSchemaOf } from '../json-schema/index.ts';
import type { ServedRejection } from './served.ts';

/** The name of the component every Rejection travels in. */
export const rejectionEnvelopeName = 'RejectionEnvelope';

/** The name of the component every Fault travels in. */
export const faultEnvelopeName = 'FaultEnvelope';

/** The components that say what travels: the two Envelopes, and the Envelope of each Rejection given. */
export function envelopeComponentsOf(
  rejections: readonly ServedRejection[],
): Readonly<Record<string, JsonSchema>> {
  const ofCodes = rejections.map(
    (rejection) => [rejection.code, codeEnvelopeOf(rejection)] as const,
  );
  return Object.fromEntries([
    [rejectionEnvelopeName, rejectionEnvelope],
    [faultEnvelopeName, faultEnvelope],
    ...ofCodes,
  ]);
}

/** A Rejection as it travels over HTTP: `{ rejection: { code, message, body? } }`. */
const rejectionEnvelope: JsonSchema = {
  type: 'object',
  required: ['rejection'],
  properties: {
    rejection: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, body: {} },
    },
  },
};

/** A Fault as it travels over HTTP, with a code only when it is a reserved one. */
const faultEnvelope: JsonSchema = {
  type: 'object',
  required: ['fault'],
  properties: {
    fault: {
      type: 'object',
      required: ['committed', 'retryable', 'message'],
      properties: {
        code: { enum: Object.keys(reservedFaults).sort(byCodePoint) },
        committed: { enum: committedValues },
        retryable: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
};

/**
 * The Rejection Envelope narrowed to one code, with the body it declares, or none: a code with
 * no body is sent with no `body` key. Its message is any text, since each declaration sends its own.
 */
function codeEnvelopeOf({ code, body }: ServedRejection): JsonSchema {
  return {
    allOf: [componentRefOf(rejectionEnvelopeName)],
    properties: {
      rejection: definedOf({
        required: body === null ? undefined : ['body'],
        properties: {
          code: { const: code },
          message: { type: 'string' },
          body: body === null ? false : jsonSchemaOf(body, '2020-12'),
        },
      }),
    },
  };
}
