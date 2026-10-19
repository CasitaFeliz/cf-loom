import {
  type AttachmentSnapshot,
  type EndpointSnapshot,
  type ListedRejection,
  methodAndPathOf,
  ownRejectionsOf,
  type ServiceSnapshot,
} from '@casitafeliz/loom-contract/internal';
import { loomNeeds, type Needs, type Writing, zodExpressionOf } from '../schema-code/index.ts';
import { jsonLiteralOf, stringLiteralOf } from '../source-text/index.ts';
import { packageModuleOf, type SchemaFile } from './modules.ts';
import { bindingOf, fileOf, siblingOf } from './names.ts';
import { type ExportedEndpoint, isDeclaredRejection } from './reached.ts';
import { partsLinesOf } from './schema-lines.ts';

/**
 * An exported Endpoint rebuilt from its Snapshot entry, so its Input, Success and Rejections type
 * as the Service's do: its Input as declared, since Consumers write what the Service reads.
 */
export function endpointModuleOf(
  exported: ExportedEndpoint,
  snapshot: ServiceSnapshot,
): SchemaFile {
  const { endpoint } = exported;
  const needs = loomNeeds();
  const rejections = ownRejectionsOf(endpoint, snapshot);
  const guards = endpoint.guards.map(({ guard }) => siblingOf({ kind: 'guard', name: guard }));
  const declared = rejections
    .filter(isDeclaredRejection)
    .map(({ code }) => siblingOf({ kind: 'rejection', code }));
  const file = packageModuleOf({
    path: fileOf({ kind: 'endpoint', name: endpoint.name }),
    body: endpointBodyOf(exported, rejections, needs),
    siblings: [...guards, ...declared],
    needs,
  });
  return { file, defUses: [...needs.defs.values()] };
}

/** Its Success and Rejections as readers, since Consumers read them; its Guards attached. */
function endpointBodyOf(
  { id, endpoint }: ExportedEndpoint,
  rejections: readonly ListedRejection[],
  needs: Needs,
): readonly string[] {
  const declared: Writing = { mode: 'declared', needs };
  const reader: Writing = { mode: 'reader', needs };
  const listed = rejections.map(rejectionNameOf);
  return [
    `export const ${bindingOf({ kind: 'endpoint', name: endpoint.name })} = loom.defineEndpoint({`,
    `  name: ${stringLiteralOf(endpoint.name)},`,
    ...identityLinesOf(id, endpoint),
    `  visibility: ${stringLiteralOf(endpoint.visibility)},`,
    `  description: ${stringLiteralOf(endpoint.description)},`,
    ...(endpoint.lifecycle === 'active'
      ? []
      : [`  lifecycle: ${stringLiteralOf(endpoint.lifecycle)},`]),
    ...guardsLinesOf(endpoint.guards),
    ...partsLinesOf('input', endpoint.input, declared),
    `  success: { ${successFieldsOf(endpoint, reader)} },`,
    ...(listed.length === 0 ? [] : [`  rejections: [${listed.join(', ')}],`]),
    '});',
  ];
}

/** The method and path of an identity, its params' names put back in order. */
function identityLinesOf(id: string, endpoint: EndpointSnapshot): readonly string[] {
  const { method, path } = methodAndPathOf(id, endpoint.params);
  return [`  method: ${stringLiteralOf(method)},`, `  path: ${stringLiteralOf(path)},`];
}

/** The Attachments in order: a Guard bare, or with its Qualifier as the JSON recorded. */
function guardsLinesOf(guards: readonly AttachmentSnapshot[]): readonly string[] {
  if (guards.length === 0) {
    return [];
  }
  const attachments = guards.map(({ guard, qualifier }) =>
    qualifier === null
      ? bindingOf({ kind: 'guard', name: guard })
      : `{ guard: ${bindingOf({ kind: 'guard', name: guard })}, qualifier: ${jsonLiteralOf(qualifier)} }`,
  );
  return [`  guards: [${attachments.join(', ')}],`];
}

/** A Success's status, then its headers and body when it declares them. */
function successFieldsOf(endpoint: EndpointSnapshot, reader: Writing): string {
  const { status, headers, body } = endpoint.success;
  const fields = [
    `status: ${status}`,
    ...(headers === null ? [] : [`headers: ${zodExpressionOf(headers, reader)}`]),
    ...(body === null ? [] : [`body: ${zodExpressionOf(body, reader)}`]),
  ];
  return fields.join(', ');
}

function rejectionNameOf(rejection: ListedRejection): string {
  switch (rejection.kind) {
    case 'not-found':
      return 'loom.notFound';
    case 'declared':
      return bindingOf({ kind: 'rejection', code: rejection.code });
  }
}
