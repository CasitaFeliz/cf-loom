import type {
  AttachmentSnapshot,
  EndpointSnapshot,
  SchemaNode,
  ServiceSnapshot,
} from '@casitafeliz/loom-contract/internal';
import { type Needs, noNeeds, type Writing, zodExpressionOf } from '../schema-code/index.ts';
import { jsonLiteralOf, stringLiteralOf } from '../source-text/index.ts';
import { packageModuleOf, type SchemaFile, type Sibling } from './modules.ts';
import { endpointFileOf, guardFileOf, rejectionFileOf, rejectionNameOf } from './names.ts';
import { type ExportedEndpoint, ownCodesOf } from './reached.ts';

/**
 * An exported Endpoint rebuilt from its Snapshot entry: its Input as declared, so Consumers write
 * what the Service reads, its Success and Rejections as readers, its Guards attached and its own
 * Rejections listed, so the types of its Input, Success and Rejections are the Service's.
 */
export function endpointModuleOf(
  exported: ExportedEndpoint,
  snapshot: ServiceSnapshot,
): SchemaFile {
  const { endpoint } = exported;
  const needs = noNeeds();
  const rejections = rejectionsOf(endpoint, snapshot);
  const guards = endpoint.guards.map(
    ({ guard }): Sibling => ({ name: guard, path: guardFileOf(guard) }),
  );
  const standard = rejections.filter(isStandard).map(({ name }) => name);
  const file = packageModuleOf({
    path: endpointFileOf(endpoint.name),
    contractNames: ['defineEndpoint', ...standard],
    needs,
    writesSchemas: true,
    siblings: [...guards, ...rejections.filter(isDeclared)],
    body: endpointBodyOf(exported, rejections, needs),
  });
  return { file, defs: needs.defs };
}

function endpointBodyOf(
  { id, endpoint }: ExportedEndpoint,
  rejections: readonly ListedRejection[],
  needs: Needs,
): readonly string[] {
  const declared: Writing = { mode: 'declared', needs };
  const reader: Writing = { mode: 'reader', needs };
  const names = rejections.map(({ name }) => name);
  return [
    `export const ${endpoint.name} = defineEndpoint({`,
    `  name: ${stringLiteralOf(endpoint.name)},`,
    ...identityLinesOf(id, endpoint),
    `  visibility: ${stringLiteralOf(endpoint.visibility)},`,
    `  description: ${stringLiteralOf(endpoint.description)},`,
    ...(endpoint.lifecycle === 'active'
      ? []
      : [`  lifecycle: ${stringLiteralOf(endpoint.lifecycle)},`]),
    ...guardsLinesOf(endpoint.guards),
    ...partsLinesOf('input', endpoint.input, declared),
    `  success: { status: ${endpoint.success.status}${successPartsOf(endpoint, reader)} },`,
    ...(names.length === 0 ? [] : [`  rejections: [${names.join(', ')}],`]),
    '});',
  ];
}

/** The method and path of an identity, its params' names put back in order. */
function identityLinesOf(id: string, endpoint: EndpointSnapshot): readonly string[] {
  const [method = '', identityPath = ''] = id.split(' ');
  const names = [...endpoint.params];
  const path = identityPath.replaceAll('{}', () => `:${names.shift() ?? ''}`);
  return [`  method: ${stringLiteralOf(method)},`, `  path: ${stringLiteralOf(path)},`];
}

/** The Attachments in order: a Guard bare, or with its Qualifier as the JSON recorded. */
function guardsLinesOf(guards: readonly AttachmentSnapshot[]): readonly string[] {
  if (guards.length === 0) {
    return [];
  }
  const attachments = guards.map(({ guard, qualifier }) =>
    qualifier === null ? guard : `{ guard: ${guard}, qualifier: ${jsonLiteralOf(qualifier)} }`,
  );
  return [`  guards: [${attachments.join(', ')}],`];
}

/** An object of schema parts, each declared one written in a mode; none when no part is. */
export function partsLinesOf(
  key: string,
  parts: Readonly<Record<string, SchemaNode | null>>,
  writing: Writing,
): readonly string[] {
  const written = Object.entries(parts).filter(isDeclaredPart);
  if (written.length === 0) {
    return [];
  }
  const lines = written.map(([part, node]) => `    ${part}: ${zodExpressionOf(node, writing)},`);
  return [`  ${key}: {`, ...lines, '  },'];
}

function isDeclaredPart(part: [string, SchemaNode | null]): part is [string, SchemaNode] {
  return part[1] !== null;
}

function successPartsOf(endpoint: EndpointSnapshot, reader: Writing): string {
  const { headers, body } = endpoint.success;
  const headersText = headers === null ? '' : `, headers: ${zodExpressionOf(headers, reader)}`;
  const bodyText = body === null ? '' : `, body: ${zodExpressionOf(body, reader)}`;
  return `${headersText}${bodyText}`;
}

/** A Rejection an Endpoint lists: `notFound`, or a declared one by its name and file. */
type ListedRejection =
  | { readonly kind: 'standard'; readonly name: 'notFound' }
  | (Sibling & { readonly kind: 'declared' });

/** The Endpoint's own Rejections: `notFound` from `@casitafeliz/loom-contract`, the others from their files. */
function rejectionsOf(
  endpoint: EndpointSnapshot,
  snapshot: ServiceSnapshot,
): readonly ListedRejection[] {
  const notFoundCode = snapshot.standardRejections.notFound.code;
  return ownCodesOf(endpoint, snapshot).map((code) =>
    code === notFoundCode
      ? { kind: 'standard', name: 'notFound' }
      : { kind: 'declared', name: rejectionNameOf(code), path: rejectionFileOf(code) },
  );
}

function isStandard(
  rejection: ListedRejection,
): rejection is Extract<ListedRejection, { readonly kind: 'standard' }> {
  return rejection.kind === 'standard';
}

function isDeclared(
  rejection: ListedRejection,
): rejection is Extract<ListedRejection, { readonly kind: 'declared' }> {
  return rejection.kind === 'declared';
}
