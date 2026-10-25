import { type Contract, type Definitions, isGuard, isRejection } from '../declarations/index.ts';
import type { ValidContract } from '../validation/index.ts';
import { isSchema } from '../written/index.ts';
import { codeSnapshotsOf, standardRejectionsOf } from './codes.ts';
import type { SnapshotContext, SnapshotSources } from './context.ts';
import { dependencySnapshotsOf } from './dependencies.ts';
import { endpointSnapshotsOf } from './endpoints.ts';
import { guardSnapshotsOf } from './guards.ts';
import { commandSnapshotsOf, eventSnapshotsOf, subscriptionSnapshotsOf } from './messaging.ts';
import type { DefinitionsSnapshot, ExportSnapshot, ServiceSnapshot, Snapshot } from './types.ts';

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
  const sources = sourcesOf(validated);
  const standardRejections = standardRejectionsOf(sources);
  return {
    format: 1,
    kind: 'service',
    name: root.name,
    generator: context.generator,
    standardRejections,
    defs: schemas.defs,
    endpoints: endpointSnapshotsOf(declarations.endpoints, sources, context),
    events: eventSnapshotsOf(declarations.events, sources),
    commands: commandSnapshotsOf(declarations.commands, sources),
    guards: guardSnapshotsOf(declarations.guards, sources),
    codes: codeSnapshotsOf(declarations.codes, sources),
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
  const sources = sourcesOf(validated);
  const standardRejections = standardRejectionsOf(sources);
  const exported = Object.entries(declarations.exports).filter(([, value]) => value !== root);
  const exports = exported.map(([name, value]) => [name, exportSnapshotOf(value, sources)]);
  return {
    format: 1,
    kind: 'definitions',
    name: declarations.packageName,
    generator: context.generator,
    standardRejections,
    defs: schemas.defs,
    exports: Object.fromEntries(exports),
    guards: guardSnapshotsOf(declarations.guards, sources),
    codes: codeSnapshotsOf(declarations.codes, sources),
  };
}

/** An export as its Snapshot records it; validation lets nothing else through. */
function exportSnapshotOf(value: unknown, sources: SnapshotSources): ExportSnapshot {
  if (isGuard(value)) {
    return { kind: 'guard', guard: value.name };
  }
  if (isRejection(value)) {
    return { kind: 'rejection', code: value.code };
  }
  const schema = isSchema(value) ? sources.nodeOf(value, 'schema') : undefined;
  if (schema !== undefined) {
    return { kind: 'schema', schema };
  }
  throw new Error('A valid Definitions root exported what it does not share: a bug.');
}

function sourcesOf({ schemas, declarations }: ValidContract): SnapshotSources {
  return {
    nodeOf: schemas.nodeOf,
    standards: declarations.standardRejections,
    standardsFrom: declarations.standardsFrom,
  };
}
