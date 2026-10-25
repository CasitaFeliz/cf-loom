import { byCodePoint, type ServiceSnapshot } from '@cf-loom/contract/internal';
import { defComponentsOf, type JsonSchema } from '../json-schema/index.ts';
import { authorizationScheme } from './authorization.ts';
import { envelopeComponentsOf } from './envelopes.ts';
import type { OpenApiObject } from './objects.ts';
import { operationOf } from './operations.ts';
import { type ListedEndpoint, listedEndpointsOf, pathConflictLineOf } from './paths.ts';
import {
  type Served,
  type ServedRejection,
  servedNodesOf,
  servedOf,
  servedRejectionsOf,
  servedSchemesOf,
} from './served.ts';

/** An OpenAPI 3.1 document as `cf-loom openapi` prints it: a JSON value. */
export type OpenApiDocument = {
  readonly openapi: '3.1.1';
  readonly info: { readonly title: string; readonly version: string };
  readonly tags: readonly { readonly name: string }[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiObject>>>>;
  readonly components: {
    readonly schemas: Readonly<Record<string, JsonSchema>>;
    readonly securitySchemes?: Readonly<Record<string, OpenApiObject>>;
  };
};

/** The document of a Service's Endpoints, or the line saying what of its Snapshot OpenAPI cannot name. */
export type OpenApiWritten =
  | { readonly kind: 'written'; readonly document: OpenApiDocument }
  | { readonly kind: 'unnamed'; readonly line: string };

/** An Endpoint listed with what `serve` reads and answers of it. */
type ServedEndpoint = ListedEndpoint & { readonly served: Served };

/** The OpenAPI document of a Service's Endpoints at a version, as `serve` answers them. */
export function openApiDocumentOf(snapshot: ServiceSnapshot, version: string): OpenApiWritten {
  const listed = listedEndpointsOf(snapshot.endpoints);
  const conflict = pathConflictLineOf(listed);
  if (conflict !== undefined) {
    return { kind: 'unnamed', line: conflict };
  }
  const endpoints = listed.map((one) => ({ ...one, served: servedOf(one.endpoint, snapshot) }));
  const defs = defComponentsOf(
    endpoints.flatMap(({ served }) => servedNodesOf(served)),
    snapshot.defs,
    '2020-12',
  );
  const envelopes = envelopeComponentsOf(rejectionsOf(endpoints));
  const document: OpenApiDocument = {
    openapi: '3.1.1',
    info: { title: snapshot.name, version },
    tags: tagsOf(listed),
    paths: pathsOf(endpoints),
    components: componentsOf({ ...defs, ...envelopes }, endpoints),
  };
  return { kind: 'written', document };
}

/** The Rejections the Endpoints answer, each code once. */
function rejectionsOf(endpoints: readonly ServedEndpoint[]): readonly ServedRejection[] {
  const rejectionByCode = new Map<string, ServedRejection>();
  for (const { served } of endpoints) {
    for (const rejection of servedRejectionsOf(served)) {
      rejectionByCode.set(rejection.code, rejection);
    }
  }
  return [...rejectionByCode.values()];
}

function tagsOf(listed: readonly ListedEndpoint[]): readonly { readonly name: string }[] {
  const groups = [...new Set(listed.map(({ endpoint }) => endpoint.group))];
  return groups.sort(byCodePoint).map((name) => ({ name }));
}

/** The path items in code point order of their template, each holding its OpenAPI operations by method. */
function pathsOf(endpoints: readonly ServedEndpoint[]): OpenApiDocument['paths'] {
  const operationsByPath = new Map<string, Record<string, OpenApiObject>>();
  for (const { method, path, endpoint, served } of endpoints) {
    const operations = operationsByPath.get(path) ?? {};
    operations[method.toLowerCase()] = operationOf(endpoint, served);
    operationsByPath.set(path, operations);
  }
  const items = [...operationsByPath].map(([path, operations]) => [path, byName(operations)]);
  return byName(Object.fromEntries(items));
}

/** The schemas, and the security schemes the Endpoints require, if any, each in code point order. */
function componentsOf(
  schemas: Readonly<Record<string, JsonSchema>>,
  endpoints: readonly ServedEndpoint[],
): OpenApiDocument['components'] {
  const names = new Set(endpoints.flatMap(({ served }) => servedSchemesOf(served)));
  if (names.size === 0) {
    return { schemas: byName(schemas) };
  }
  const securitySchemes = Object.fromEntries([...names].map((name) => [name, authorizationScheme]));
  return { schemas: byName(schemas), securitySchemes: byName(securitySchemes) };
}

/** The entries of an object in code point order of their names. */
function byName<Value>(entries: Readonly<Record<string, Value>>): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => byCodePoint(left, right)),
  );
}
