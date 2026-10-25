import {
  deprecationHeader,
  deprecationHeaderOf,
  faultStatusOf,
  type ObjectNode,
  reservedFaults,
} from '@cf-loom/contract/internal';
import { componentRefOf, definedOf, type JsonSchema, jsonSchemaOf } from '../json-schema/index.ts';
import { jsonContentOf } from './content.ts';
import { faultEnvelopeName } from './envelopes.ts';
import type { OpenApiObject } from './objects.ts';
import type { LiveServed, Served, ServedRejection } from './served.ts';

/** What one Outcome of an Endpoint adds to the response of its status. */
type StatusPart = {
  readonly status: number;
  readonly description: string;
  readonly headers?: Readonly<Record<string, OpenApiObject>>;
  readonly schema?: JsonSchema | undefined;
};

/** The responses `serve` gives an Endpoint, one per status in status order. */
export function responsesOf(served: Served): OpenApiObject {
  switch (served.kind) {
    case 'retired':
      return responsesFrom([retiredPart], undefined);
    case 'live':
      return responsesFrom(livePartsOf(served), served.deprecatedAt);
  }
}

function livePartsOf({ success, rejections, input }: LiveServed): readonly StatusPart[] {
  return [successPartOf(success), ...rejections.map(rejectionPartOf), ...faultPartsOf(input)];
}

/** `RETIRED`, which a Retired Endpoint answers before any Guard. */
const retiredPart: StatusPart = {
  status: reservedFaults.RETIRED.status,
  description: `RETIRED: ${reservedFaults.RETIRED.message}`,
  schema: componentRefOf(faultEnvelopeName),
};

function successPartOf(success: LiveServed['success']): StatusPart {
  return {
    status: success.status,
    description: 'Success',
    headers: headersOf(success.headers),
    schema: success.body === null ? undefined : jsonSchemaOf(success.body, '2020-12'),
  };
}

function headersOf(headers: ObjectNode | null): Readonly<Record<string, OpenApiObject>> {
  const entries = Object.entries(headers?.fields ?? {}).map(([name, field]) => {
    const schema = jsonSchemaOf(field.schema, '2020-12');
    const description = field.schema.description;
    return [name, definedOf({ required: field.required, description, schema })] as const;
  });
  return Object.fromEntries(entries);
}

function rejectionPartOf({ code, status, message }: ServedRejection): StatusPart {
  return { status, description: `${code}: ${message}`, schema: componentRefOf(code) };
}

/** The `Retry-After` a retryable Fault may carry. */
const retryAfterHeader = 'retry-after';

const retryAfterObject: OpenApiObject = {
  required: false,
  description: 'When to retry, in whole seconds, if the Fault says',
  schema: { type: 'integer', minimum: 0 },
};

/** The Faults `serve` may answer any Endpoint: 500 and 503, and 413 when a body is read. */
function faultPartsOf({ body }: LiveServed['input']): readonly StatusPart[] {
  const schema = componentRefOf(faultEnvelopeName);
  const tooLarge = reservedFaults.BODY_TOO_LARGE;
  const parts: StatusPart[] = [
    {
      status: faultStatusOf({ retryable: false }),
      description: 'A Fault that is not retryable, or INVALID_OUTCOME',
      schema,
    },
    {
      status: faultStatusOf({ retryable: true }),
      description: 'A retryable Fault',
      headers: { [retryAfterHeader]: retryAfterObject },
      schema,
    },
  ];
  if (body !== null) {
    const description = `BODY_TOO_LARGE: ${tooLarge.message}, when serve is given maxBodyBytes as a number`;
    parts.push({ status: tooLarge.status, description, schema });
  }
  return parts;
}

/** One response per status in status order: the descriptions joined, the schemas alternatives. */
function responsesFrom(
  parts: readonly StatusPart[],
  deprecatedAt: string | undefined,
): OpenApiObject {
  const byStatus = new Map<number, StatusPart[]>();
  for (const part of parts) {
    byStatus.set(part.status, [...(byStatus.get(part.status) ?? []), part]);
  }
  const statuses = [...byStatus.keys()].sort((left, right) => left - right);
  return Object.fromEntries(
    statuses.map((status) => [
      String(status),
      responseOf(byStatus.get(status) ?? [], deprecatedAt),
    ]),
  );
}

function responseOf(parts: readonly StatusPart[], deprecatedAt: string | undefined): OpenApiObject {
  const partHeaders = parts.flatMap(({ headers }) => Object.entries(headers ?? {}));
  const deprecation = Object.entries(deprecationOf(deprecatedAt));
  const headers = Object.fromEntries([...partHeaders, ...deprecation]);
  const schemas = parts.map(({ schema }) => schema).filter(isSchema);
  return definedOf({
    description: parts.map(({ description }) => description).join('; '),
    headers: Object.keys(headers).length === 0 ? undefined : headers,
    content: schemas.length === 0 ? undefined : jsonContentOf(alternativesOf(schemas)),
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
