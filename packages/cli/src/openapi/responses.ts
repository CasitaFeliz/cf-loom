import {
  deprecationHeader,
  deprecationHeaderOf,
  faultStatusOf,
  type ObjectNode,
  reservedCodeFaults,
} from '@cf-loom/contract/internal';
import { componentRefOf, definedOf, type JsonSchema, jsonSchemaOf } from '../json-schema/index.ts';
import { jsonContentOf } from './content.ts';
import { faultEnvelopeName } from './envelopes.ts';
import type { OpenApiObject } from './objects.ts';
import type { LiveServed, Served, ServedRejection } from './served.ts';

/** A header as one Outcome of an Endpoint declares it. */
type HeaderPart = {
  readonly required: boolean;
  readonly description: string | undefined;
  readonly schema: JsonSchema;
};

/** What one Outcome of an Endpoint adds to the response of its status. */
type StatusPart = {
  readonly status: number;
  readonly description: string;
  readonly headers?: Readonly<Record<string, HeaderPart>>;
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
  status: reservedCodeFaults.RETIRED.status,
  description: `RETIRED: ${reservedCodeFaults.RETIRED.message}`,
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

function headersOf(headers: ObjectNode): Readonly<Record<string, HeaderPart>> {
  const entries = Object.entries(headers.fields).map(([name, field]) => {
    const schema = jsonSchemaOf(field.schema, '2020-12');
    const header = { required: field.required, description: field.schema.description, schema };
    return [name, header] as const;
  });
  return Object.fromEntries(entries);
}

function rejectionPartOf({ code, status, message, headers }: ServedRejection): StatusPart {
  const description = `${code}: ${message}`;
  return { status, description, headers: headersOf(headers), schema: componentRefOf(code) };
}

/** The `Retry-After` a retryable Fault may carry. */
const retryAfterHeader = 'retry-after';

const retryAfterObject: HeaderPart = {
  required: false,
  description: 'When to retry, in whole seconds, if the Fault says',
  schema: { type: 'integer', minimum: 0 },
};

/** The Faults `serve` may answer any Endpoint: 500 and 503, and 413 when a body is read. */
function faultPartsOf({ body }: LiveServed['input']): readonly StatusPart[] {
  const schema = componentRefOf(faultEnvelopeName);
  const tooLarge = reservedCodeFaults.BODY_TOO_LARGE;
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
  const headers = { ...mergedHeadersOf(parts), ...deprecationOf(deprecatedAt) };
  const schemas = parts.map(({ schema }) => schema).filter(isSchema);
  return definedOf({
    description: parts.map(({ description }) => description).join('; '),
    headers: Object.keys(headers).length === 0 ? undefined : headers,
    content: schemas.length === 0 ? undefined : jsonContentOf(alternativesOf(schemas)),
  });
}

/** The headers of one status's parts, each name once. */
function mergedHeadersOf(parts: readonly StatusPart[]): Readonly<Record<string, OpenApiObject>> {
  const names = new Set(parts.flatMap(({ headers }) => Object.keys(headers ?? {})));
  const merged = [...names].map((name) => [name, mergedHeaderOf(name, parts)] as const);
  return Object.fromEntries(merged);
}

/**
 * A header of one status: required only when every part of the status requires it, its schemas
 * the alternatives of those the parts declare, and its descriptions joined.
 */
function mergedHeaderOf(name: string, parts: readonly StatusPart[]): OpenApiObject {
  const declared = parts.map(({ headers }) => headers?.[name]).filter(isHeader);
  const required = parts.every(({ headers }) => headers?.[name]?.required === true);
  const descriptions = new Set(declared.map(({ description }) => description).filter(isText));
  const schemas = new Map(declared.map(({ schema }) => [JSON.stringify(schema), schema]));
  return definedOf({
    required,
    description: descriptions.size === 0 ? undefined : [...descriptions].join('; '),
    schema: alternativesOf([...schemas.values()]),
  });
}

function isHeader(header: HeaderPart | undefined): header is HeaderPart {
  return header !== undefined;
}

function isText(text: string | undefined): text is string {
  return text !== undefined;
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
