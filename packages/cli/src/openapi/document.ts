import {
  byCodePoint,
  type CodeSnapshot,
  isLive,
  type SchemaNode,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';
import { defComponentsOf, type JsonSchema } from '../json-schema/index.ts';
import { envelopeComponentsOf } from './envelopes.ts';
import type { OpenApiObject } from './objects.ts';
import { operationOf, writtenPartsOf } from './operations.ts';
import { type ListedEndpoint, listedEndpointsOf, pathConflictLineOf } from './paths.ts';

/** An OpenAPI 3.1 document as `cf-loom openapi` prints it: a JSON value. */
export type OpenApiDocument = {
  readonly openapi: '3.1.1';
  readonly info: { readonly title: string; readonly version: string };
  readonly tags: readonly { readonly name: string }[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiObject>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, JsonSchema>> };
};

/** The document of a Service's Endpoints, or the line saying what of its Snapshot OpenAPI cannot name. */
export type OpenApiWritten =
  | { readonly kind: 'written'; readonly document: OpenApiDocument }
  | { readonly kind: 'unnamed'; readonly line: string };

/** The version a document carries, as the Contract Package `package` writes: only `publish` derives one. */
const localVersion = '0.0.0';

/** The OpenAPI document of a Service's Endpoints, as `serve` answers them. */
export function openApiDocumentOf(snapshot: ServiceSnapshot): OpenApiWritten {
  const listed = listedEndpointsOf(snapshot.endpoints);
  const conflict = pathConflictLineOf(listed);
  if (conflict !== undefined) {
    return { kind: 'unnamed', line: conflict };
  }
  const codes = answeredCodesOf(listed);
  const parts = [
    ...listed.flatMap(({ endpoint }) => writtenPartsOf(endpoint)),
    ...codes.map((code) => snapshot.codes[code]?.body),
  ];
  const defs = defComponentsOf(parts.filter(isNode), snapshot.defs);
  if (defs.kind === 'unnamed') {
    return { kind: 'unnamed', line: defs.line };
  }
  const schemas = { ...defs.schemas, ...envelopeComponentsOf(codes, snapshot.codes) };
  const document: OpenApiDocument = {
    openapi: '3.1.1',
    info: { title: snapshot.name, version: localVersion },
    tags: tagsOf(listed),
    paths: pathsOf(listed, snapshot.codes),
    components: { schemas: byName(schemas) },
  };
  return { kind: 'written', document };
}

function isNode(node: SchemaNode | null | undefined): node is SchemaNode {
  return node !== null && node !== undefined;
}

/** The codes the Endpoints that are not Retired answer, each once. */
function answeredCodesOf(listed: readonly ListedEndpoint[]): readonly string[] {
  const live = listed.filter(({ endpoint }) => isLive(endpoint));
  return [...new Set(live.flatMap(({ endpoint }) => endpoint.rejections))];
}

function tagsOf(listed: readonly ListedEndpoint[]): readonly { readonly name: string }[] {
  const groups = [...new Set(listed.map(({ endpoint }) => endpoint.group))];
  return groups.sort(byCodePoint).map((name) => ({ name }));
}

/** The path items in code point order of their template, each holding its operations by method. */
function pathsOf(
  listed: readonly ListedEndpoint[],
  codes: Readonly<Record<string, CodeSnapshot>>,
): OpenApiDocument['paths'] {
  const operationsByPath = new Map<string, Record<string, OpenApiObject>>();
  for (const { method, path, endpoint } of listed) {
    const operations = operationsByPath.get(path) ?? {};
    operations[method.toLowerCase()] = operationOf(method, endpoint, codes);
    operationsByPath.set(path, operations);
  }
  const items = [...operationsByPath].map(([path, operations]) => [path, byName(operations)]);
  return byName(Object.fromEntries(items));
}

/** The entries of an object in code point order of their names. */
function byName<Value>(entries: Readonly<Record<string, Value>>): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => byCodePoint(left, right)),
  );
}
