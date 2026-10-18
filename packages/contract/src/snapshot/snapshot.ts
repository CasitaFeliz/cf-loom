import type { Contract, Definitions } from '../declarations/index.ts';
import type { ValidatedContract } from '../validation/index.ts';
import { codesOf, standardRejectionsOf } from './codes.ts';
import { nodeLookupOf, type SnapshotContext, type Sources } from './context.ts';
import { dependenciesOf } from './dependencies.ts';
import { endpointsOf } from './endpoints.ts';
import { guardsOf } from './guards.ts';
import type {
  ApplicationSnapshot,
  DefinitionsSnapshot,
  ServiceSnapshot,
  Snapshot,
} from './types.ts';

/** A root the validation found valid: the only input a Snapshot is built from. */
export type ValidContract = Extract<ValidatedContract, { readonly kind: 'valid' }>;

/**
 * The declared Snapshot of a valid root, as `generate` writes it: every map keyed by identity or
 * name, every array whose order means nothing sorted, and no `version`, which `publish` fills in.
 */
export function snapshotOf(validated: ValidContract, context: SnapshotContext): Snapshot {
  const { root } = validated.declarations;
  switch (root.kind) {
    case 'contract':
      return serviceSnapshotOf(validated, { root, context });
    case 'application':
      return {
        format: 1,
        kind: 'application',
        name: root.name,
        generator: context.generator,
        dependencies: dependenciesOf(validated.declarations.dependencies),
      } satisfies ApplicationSnapshot;
    case 'definitions':
      return definitionsSnapshotOf(validated, { root, context });
  }
}

function serviceSnapshotOf(
  { schemas, declarations }: ValidContract,
  { root, context }: { readonly root: Contract; readonly context: SnapshotContext },
): ServiceSnapshot {
  const sources = sourcesOf({ schemas, declarations }, context);
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
    endpoints: endpointsOf(declarations.endpoints, sources, context),
    events: {},
    commands: {},
    guards: guardsOf(declarations.guards, sources),
    codes: codesOf(declarations.codes, standardRejections, sources),
    subscriptions: {},
    dependencies: dependenciesOf(declarations.dependencies),
  };
}

function definitionsSnapshotOf(
  { schemas, declarations }: ValidContract,
  { root, context }: { readonly root: Definitions; readonly context: SnapshotContext },
): DefinitionsSnapshot {
  const sources = sourcesOf({ schemas, declarations }, context);
  const standardRejections = standardRejectionsOf(sources);
  const shared = Object.keys(root.schemas ?? {}).map((name) => [
    name,
    sources.nodeAt(['schemas', name]),
  ]);
  return {
    format: 1,
    kind: 'definitions',
    name: root.name,
    generator: context.generator,
    standardRejections,
    defs: schemas.defs,
    schemas: Object.fromEntries(shared),
    guards: guardsOf(declarations.guards, sources),
    codes: codesOf(declarations.codes, standardRejections, sources),
  };
}

function sourcesOf(
  { schemas, declarations }: Omit<ValidContract, 'kind'>,
  context: SnapshotContext,
): Sources {
  const atByGuard = new Map(declarations.guards.map(({ at, guard }) => [guard, at]));
  return {
    nodeAt: nodeLookupOf(schemas),
    guardAt: (guard) => {
      const at = atByGuard.get(guard);
      if (at === undefined) {
        throw new Error(
          `A valid root gathers every Guard it attaches: ${guard.name} is missing, a bug.`,
        );
      }
      return at;
    },
    standards: declarations.standardRejections,
    packages: context.packages,
  };
}
