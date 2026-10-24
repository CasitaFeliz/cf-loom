import {
  type CodeSnapshot,
  deprecationHeader,
  deprecationHeaderOf,
  type EndpointSnapshot,
  faultStatusOf,
  type ObjectNode,
  reservedFaults,
} from '@cf-loom/contract/internal';
import { componentRefOf, definedOf, type JsonSchema, jsonSchemaOf } from '../json-schema/index.ts';
import { jsonContentOf } from './content.ts';
import { faultEnvelopeName } from './envelopes.ts';
import type { OpenApiObject } from './objects.ts';

/** What one Outcome of an Endpoint adds to the response of its status. */
type Answer = {
  readonly status: number;
  readonly description: string;
  readonly headers?: Readonly<Record<string, OpenApiObject>>;
  readonly schema?: JsonSchema | undefined;
};

/** What every response of an operation shares: whether the host drops its bodies, and its Deprecation stamp. */
type Shared = { readonly isHead: boolean; readonly deprecatedAt: string | undefined };

/**
 * What `serve` answers an Endpoint: its Success, its Rejections and the Faults any Endpoint may
 * answer, one response per status in status order, each with the Deprecation header when the
 * Endpoint is Deprecated.
 */
export function responsesOf(
  method: string,
  endpoint: EndpointSnapshot,
  codes: Readonly<Record<string, CodeSnapshot>>,
): OpenApiObject {
  const answers = [
    successAnswerOf(endpoint),
    ...endpoint.rejections.map((code) => rejectionAnswerOf(code, codes)),
    ...faultAnswersOf(endpoint),
  ];
  return responsesFrom(answers, { isHead: method === 'HEAD', deprecatedAt: endpoint.deprecatedAt });
}

/** What `serve` answers a Retired Endpoint: `RETIRED`, before any Guard, with no Deprecation header. */
export function retiredResponsesOf(method: string): OpenApiObject {
  const { status, message } = reservedFaults.RETIRED;
  const answer: Answer = {
    status,
    description: `RETIRED: ${message}`,
    schema: componentRefOf(faultEnvelopeName),
  };
  return responsesFrom([answer], { isHead: method === 'HEAD', deprecatedAt: undefined });
}

function successAnswerOf({ success }: EndpointSnapshot): Answer {
  return {
    status: success.status,
    description: 'Success',
    headers: headersOf(success.headers),
    schema: success.body === null ? undefined : jsonSchemaOf(success.body),
  };
}

function headersOf(headers: ObjectNode | null): Readonly<Record<string, OpenApiObject>> {
  const entries = Object.entries(headers?.fields ?? {}).map(([name, field]) => {
    const schema = jsonSchemaOf(field.schema);
    const header = definedOf({
      required: field.required,
      description: field.schema.description,
      schema,
    });
    return [name, header] as const;
  });
  return Object.fromEntries(entries);
}

function rejectionAnswerOf(code: string, codes: Readonly<Record<string, CodeSnapshot>>): Answer {
  const resolved = codes[code];
  if (resolved === undefined) {
    throw new Error(`The Endpoint answers the code ${code}, which the codes given lack`);
  }
  return {
    status: resolved.status,
    description: `${code}: ${resolved.message}`,
    schema: componentRefOf(code),
  };
}

/** The Faults `serve` may answer any Endpoint: 500 and 503, and 413 when a body is read. */
function faultAnswersOf({ input }: EndpointSnapshot): readonly Answer[] {
  const schema = componentRefOf(faultEnvelopeName);
  const tooLarge = reservedFaults.BODY_TOO_LARGE;
  const answers: Answer[] = [
    {
      status: faultStatusOf({ retryable: false }),
      description: 'A Fault that is not retryable, or INVALID_OUTCOME',
      schema,
    },
    { status: faultStatusOf({ retryable: true }), description: 'A retryable Fault', schema },
  ];
  if (input.body !== null) {
    const description = `BODY_TOO_LARGE: ${tooLarge.message}, when serve is given maxBodyBytes`;
    answers.push({ status: tooLarge.status, description, schema });
  }
  return answers;
}

/** One response per status in status order: the descriptions joined, the schemas alternatives. */
function responsesFrom(answers: readonly Answer[], shared: Shared): OpenApiObject {
  const byStatus = new Map<number, Answer[]>();
  for (const answer of answers) {
    byStatus.set(answer.status, [...(byStatus.get(answer.status) ?? []), answer]);
  }
  const statuses = [...byStatus.keys()].sort((left, right) => left - right);
  return Object.fromEntries(
    statuses.map((status) => [String(status), responseOf(byStatus.get(status) ?? [], shared)]),
  );
}

function responseOf(answers: readonly Answer[], { isHead, deprecatedAt }: Shared): OpenApiObject {
  const answered = answers.flatMap(({ headers }) => Object.entries(headers ?? {}));
  const headers = Object.fromEntries([...answered, ...Object.entries(deprecationOf(deprecatedAt))]);
  const schemas = answers.map(({ schema }) => schema).filter(isSchema);
  return definedOf({
    description: answers.map(({ description }) => description).join('; '),
    headers: Object.keys(headers).length === 0 ? undefined : headers,
    content: isHead || schemas.length === 0 ? undefined : jsonContentOf(alternativesOf(schemas)),
  });
}

function isSchema(schema: JsonSchema | undefined): schema is JsonSchema {
  return schema !== undefined;
}

function alternativesOf(schemas: readonly JsonSchema[]): JsonSchema {
  const [only] = schemas;
  return schemas.length === 1 && only !== undefined ? only : { oneOf: schemas };
}

function deprecationOf(deprecatedAt: string | undefined): Readonly<Record<string, OpenApiObject>> {
  if (deprecatedAt === undefined) {
    return {};
  }
  const schema = { type: 'string', const: deprecationHeaderOf(deprecatedAt) };
  return { [deprecationHeader]: { required: true, schema } };
}
