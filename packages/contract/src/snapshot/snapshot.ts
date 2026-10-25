import type { Contract } from '../declarations/index.ts';
import type { ValidContract } from '../validation/index.ts';
import type { Member } from '../written/index.ts';
import { codeSnapshotsOf, standardRejectionsOf } from './codes.ts';
import type { SnapshotContext, SnapshotSources } from './context.ts';
import { dependencySnapshotsOf } from './dependencies.ts';
import { endpointSnapshotsOf } from './endpoints.ts';
import { guardSnapshotsOf } from './guards.ts';
import { commandSnapshotsOf, eventSnapshotsOf, subscriptionSnapshotsOf } from './messaging.ts';
import {
  type DefinitionsSnapshot,
  type ExportSnapshot,
  type ServiceSnapshot,
  type Snapshot,
  writtenSnapshotFormat,
} from './types.ts';

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
        format: writtenSnapshotFormat,
        kind: 'application',
        name: root.name,
        generator: context.generator,
        dependencies: dependencySnapshotsOf(validated.declarations.dependencies),
      };
    case 'definitions':
      return definitionsSnapshotOf(validated, context);
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
    format: writtenSnapshotFormat,
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
  context: SnapshotContext,
): DefinitionsSnapshot {
  const { schemas, declarations } = validated;
  const sources = sourcesOf(validated);
  const standardRejections = standardRejectionsOf(sources);
  const exports: (readonly [string, ExportSnapshot])[] = [];
  for (const member of declarations.ownMembers ?? []) {
    const exported = exportSnapshotOf(member, sources);
    if (exported !== undefined) {
      exports.push([member.name, exported]);
    }
  }
  return {
    format: writtenSnapshotFormat,
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

/** A member as its Snapshot records it: a Guard by name, a Rejection by code, a schema by its walked node. */
function exportSnapshotOf(member: Member, { nodeOf }: SnapshotSources): ExportSnapshot | undefined {
  switch (member.kind) {
    case 'guard':
      return { kind: 'guard', guard: member.value.name };
    case 'rejection':
      return { kind: 'rejection', code: member.value.code };
    case 'schema': {
      const schema = nodeOf(member.value, 'schema');
      return schema === undefined ? undefined : { kind: 'schema', schema };
    }
  }
}

function sourcesOf({ schemas, declarations }: ValidContract): SnapshotSources {
  return {
    nodeOf: schemas.nodeOf,
    standards: declarations.standardRejections,
    standardRejectionsSource: declarations.standardRejectionsSource,
  };
}
