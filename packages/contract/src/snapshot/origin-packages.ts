import { type OriginPackage, originPackageOf } from '../validation/index.ts';
import { byCodePoint, nodesWithin, type SchemaNode } from '../walker/index.ts';
import { codeNodesOf, endpointNodesOf, guardNodesOf } from './nodes.ts';
import type { CodeSnapshot, ExportSnapshot, GuardSnapshot, Snapshot } from './types.ts';

/**
 * Every package version the origins of a declared Snapshot name, each once, by package then
 * version: the Definitions Packages a Contract uses, at the versions it used them.
 */
export function originPackagesOf(snapshot: Snapshot): readonly OriginPackage[] {
  const nodeOrigins = nodesOf(snapshot)
    .flatMap((node) => nodesWithin(node, []))
    .map(({ node }) => node.origin);
  const origins = [...nodeOrigins, ...declaringOrigins(snapshot).map(({ origin }) => origin)];
  const packages = origins.map(originPackageOf).filter(isPackage);
  const distinct = new Map(
    packages.map((named) => [`${named.packageName}@${named.version}`, named]),
  );
  return [...distinct.values()].sort(
    (left, right) =>
      byCodePoint(left.packageName, right.packageName) || byCodePoint(left.version, right.version),
  );
}

/** The Guards and codes of a Snapshot, which carry an origin of their own. */
function declaringOrigins(snapshot: Snapshot): readonly (GuardSnapshot | CodeSnapshot)[] {
  switch (snapshot.kind) {
    case 'service':
    case 'definitions':
      return [...Object.values(snapshot.guards), ...Object.values(snapshot.codes)];
    case 'application':
      return [];
  }
}

/** Every schema node a Snapshot holds directly: its defs, and the nodes of what it declares. */
function nodesOf(snapshot: Snapshot): readonly SchemaNode[] {
  switch (snapshot.kind) {
    case 'service': {
      const messages = [...Object.values(snapshot.events), ...Object.values(snapshot.commands)];
      return [
        ...Object.values(snapshot.defs),
        ...Object.values(snapshot.endpoints).flatMap(endpointNodesOf),
        ...messages.map(({ body }) => body),
        ...Object.values(snapshot.guards).flatMap(guardNodesOf),
        ...Object.values(snapshot.codes).flatMap(codeNodesOf),
      ];
    }
    case 'definitions': {
      const shared = Object.values(snapshot.exports)
        .filter(isSharedSchema)
        .map(({ schema }) => schema);
      return [
        ...Object.values(snapshot.defs),
        ...shared,
        ...Object.values(snapshot.guards).flatMap(guardNodesOf),
        ...Object.values(snapshot.codes).flatMap(codeNodesOf),
      ];
    }
    case 'application':
      return [];
  }
}

function isSharedSchema(
  exported: ExportSnapshot,
): exported is Extract<ExportSnapshot, { readonly kind: 'schema' }> {
  return exported.kind === 'schema';
}

function isPackage(named: OriginPackage | undefined): named is OriginPackage {
  return named !== undefined;
}
