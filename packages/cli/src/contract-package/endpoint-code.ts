import {
  type AttachmentSnapshot,
  type EndpointSnapshot,
  type ExportedCut,
  exportedCutOf,
  isDeclaredRejection,
  type ListedRejection,
  methodAndPathOf,
  ownRejectionsOf,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';
import { loomNeeds, type Needs, type Writing, zodExpressionOf } from '../schema-code/index.ts';
import { codeListOf, jsonLiteralOf, stringLiteralOf } from '../source-text/index.ts';
import { deprecatedLinesOf, elementLinesOf } from './element-lines.ts';
import type { ExportedEndpoint } from './exported-snapshot.ts';
import { packageModuleOf, type SchemaFile } from './modules.ts';
import {
  bindingOf,
  fileOf,
  providedOpeningOf,
  siblingOf,
  standardRejectionsSibling,
} from './names.ts';
import { declaredTextPartOf, partsLinesOf } from './schema-lines.ts';

/**
 * An exported Endpoint rebuilt from its Snapshot entry and marked as the Service's, so its Input,
 * Success and Rejections type as the Service's do: its Input as declared, since Consumers write
 * what the Service reads. It carries the Service's Standard Rejections and the exported Snapshot
 * cut to it, so a Consumer that imports it needs nothing else of the package.
 */
export function endpointModuleOf(
  exported: ExportedEndpoint,
  snapshot: ServiceSnapshot | PublishedServiceSnapshot,
): SchemaFile {
  const { endpoint } = exported;
  const packaged = { kind: 'endpoint', name: endpoint.name } as const;
  const needs = loomNeeds();
  const rejections = ownRejectionsOf(endpoint, snapshot);
  const guards = endpoint.guards.map(({ guard }) => siblingOf({ kind: 'guard', name: guard }));
  const declared = rejections
    .filter(isDeclaredRejection)
    .map(({ code }) => siblingOf({ kind: 'rejection', code }));
  const file = packageModuleOf({
    path: fileOf(packaged),
    body: [
      ...deprecatedLinesOf(endpoint),
      providedOpeningOf(packaged, providerTextOf(snapshot.name)),
      ...endpointBodyOf(exported, rejections, needs),
      closingLineOf(exportedCutOf(snapshot, exported.id)),
    ],
    siblings: [...guards, ...declared, standardRejectionsSibling],
    needs,
  });
  return { file, defUses: [...needs.defs.values()] };
}

/** The Provider an Endpoint is marked with: its name, and its Standard Rejections, which the module imports. */
function providerTextOf(provider: string): string {
  return `{ name: ${stringLiteralOf(provider)}, ${standardRejectionsSibling.name} }`;
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
    `  name: ${stringLiteralOf(endpoint.name)},`,
    ...identityLinesOf(id, endpoint),
    ...elementLinesOf(endpoint),
    ...deprecationLinesOf(endpoint),
    ...guardsLinesOf(endpoint.guards),
    ...partsLinesOf('input', declaredInputOf(endpoint.input), declared),
    `  success: { ${successFieldsOf(endpoint, reader)} },`,
    ...(listed.length === 0 ? [] : [`  rejections: [${codeListOf(listed)}],`]),
  ];
}

/** The close of the declaration, with the Endpoint's cut passed beside it. */
function closingLineOf(cut: ExportedCut): string {
  return `}, ${jsonLiteralOf(cut, 'indented')});`;
}

/** An Endpoint's Input as the author declared it: its text parts only when they declare something. */
function declaredInputOf({ params, query, headers, body }: EndpointSnapshot['input']) {
  return {
    params,
    query: declaredTextPartOf(query),
    headers: declaredTextPartOf(headers),
    body,
  };
}

/** The method and path of an identity, its params' names put back in order. */
function identityLinesOf(id: string, endpoint: EndpointSnapshot): readonly string[] {
  const { method, path } = methodAndPathOf(id, endpoint.params);
  return [`  method: ${stringLiteralOf(method)},`, `  path: ${stringLiteralOf(path)},`];
}

/** The instant a Deprecated Endpoint is Deprecated as of, which `defineEndpoint` requires beside its lifecycle. */
function deprecationLinesOf({ deprecatedAt }: EndpointSnapshot): readonly string[] {
  return deprecatedAt === undefined ? [] : [`  deprecatedAt: ${stringLiteralOf(deprecatedAt)},`];
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
  return [`  guards: [${codeListOf(attachments)}],`];
}

/** A Success's status, then its headers and body when it declares them. */
function successFieldsOf(endpoint: EndpointSnapshot, reader: Writing): string {
  const { status, headers, body } = endpoint.success;
  const declared = declaredTextPartOf(headers);
  const fields = [
    `status: ${status}`,
    ...(declared === null ? [] : [`headers: ${zodExpressionOf(declared, reader)}`]),
    ...(body === null ? [] : [`body: ${zodExpressionOf(body, reader)}`]),
  ];
  return codeListOf(fields);
}

function rejectionNameOf(rejection: ListedRejection): string {
  switch (rejection.kind) {
    case 'not-found':
      return 'loom.notFound';
    case 'declared':
      return bindingOf({ kind: 'rejection', code: rejection.code });
  }
}
