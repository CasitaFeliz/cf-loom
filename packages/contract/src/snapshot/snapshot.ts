import type { Contract, Definitions } from '../declarations/index.ts';
import type { ValidContract } from '../validation/index.ts';
import { codeSnapshotsOf, standardRejectionsOf } from './codes.ts';
import type { SnapshotContext, SnapshotSources } from './context.ts';
import { dependencySnapshotsOf } from './dependencies.ts';
import { endpointSnapshotsOf } from './endpoints.ts';
import { guardSnapshotsOf } from './guards.ts';
import { commandSnapshotsOf, eventSnapshotsOf, subscriptionSnapshotsOf } from './messaging.ts';
import type { DefinitionsSnapshot, ServiceSnapshot, Snapshot } from './types.ts';

/**
 * The declared Snapshot of a valid root, as `generate` writes it: every map keyed by identity or
 * name, every array whose order means nothing sorted, and no `version`, which `publish` fills in.
 */
export function snapshotOf(validated: ValidContract, context: SnapshotContext): Snapshot {
  const { root } = validated.declarations;
  switch (root.kind) {
    case 'contract':
      return serviceSnapshotOf(validated, root, context);
    case 'application':
      return {
        format: 1,
        kind: 'application',
        name: root.name,
        generator: context.generator,
        dependencies: dependencySnapshotsOf(validated.declarations.dependencies),
      };
    case 'definitions':
      return definitionsSnapshotOf(validated, root, context);
  }
}

function serviceSnapshotOf(
  validated: ValidContract,
  root: Contract,
  context: SnapshotContext,
): ServiceSnapshot {
  const { schemas, declarations } = validated;
  const sources = sourcesOf(validated, context);
  const standardRejections = standardRejectionsOf(sources);
  const definitions = context.packages.map(({ packageName, version }) => [packageName, version]);
  return {
    format: 1,
    kind: 'service',
    name: root.name,
    generator: context.generator,
    definitions: Object.fromEntries(definitions),
    standardRejections,
    defs: schemas.defs,
    endpoints: endpointSnapshotsOf(declarations.endpoints, sources, context),
    events: eventSnapshotsOf(declarations.events, sources),
    commands: commandSnapshotsOf(declarations.commands, sources),
    guards: guardSnapshotsOf(declarations.guards, sources),
    codes: codeSnapshotsOf(declarations.codes, standardRejections, sources),
    subscriptions: subscriptionSnapshotsOf(declarations.subscriptions),
    dependencies: dependencySnapshotsOf(declarations.dependencies),
  };
}

function definitionsSnapshotOf(
  validated: ValidContract,
  root: Definitions,
  context: SnapshotContext,
): DefinitionsSnapshot {
  const { schemas, declarations } = validated;
  const sources = sourcesOf(validated, context);
  const standardRejections = standardRejectionsOf(sources);
  const shared = Object.entries(root.schemas ?? {}).map(([name, schema]) => [
    name,
    sources.nodeOf(schema, 'schema'),
  ]);
  return {
    format: 1,
    kind: 'definitions',
    name: root.name,
    generator: context.generator,
    standardRejections,
    defs: schemas.defs,
    schemas: Object.fromEntries(shared),
    guards: guardSnapshotsOf(declarations.guards, sources),
    codes: codeSnapshotsOf(declarations.codes, standardRejections, sources),
  };
}

function sourcesOf(
  { schemas, declarations }: ValidContract,
  context: SnapshotContext,
): SnapshotSources {
  return {
    nodeOf: schemas.nodeOf,
    standards: declarations.standardRejections,
    packages: context.packages,
  };
}
