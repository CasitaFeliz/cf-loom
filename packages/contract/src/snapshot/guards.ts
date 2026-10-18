import type { ValidatedGuard } from '../validation/index.ts';
import { sortedCodes } from './codes.ts';
import { declaredOriginOf, inMode, objectOf, type SnapshotSources } from './context.ts';
import type { GuardSnapshot } from './types.ts';

/**
 * The Guards the root reaches, by name: a Service's Endpoints attach them, directly or through a
 * Guard's `guards`; a Definitions Package reaches all of its own.
 */
export function guardSnapshotsOf(
  guards: readonly ValidatedGuard[],
  sources: SnapshotSources,
): Readonly<Record<string, GuardSnapshot>> {
  const reached = guards.filter((located) => located.reached);
  return Object.fromEntries(
    reached.map(({ guard }) => [guard.name, guardSnapshotOf(guard, sources)]),
  );
}

function guardSnapshotOf(
  guard: ValidatedGuard['guard'],
  { nodeOf, packages }: SnapshotSources,
): GuardSnapshot {
  return {
    origin: declaredOriginOf(packages, (definitions) => (definitions.guards ?? []).includes(guard)),
    description: guard.description,
    guards: (guard.guards ?? []).map(({ name }) => name),
    qualifier: nodeOf(guard, 'qualifier'),
    demands: {
      headers: inMode(objectOf(nodeOf(guard, 'demands.headers')), 'open'),
      query: objectOf(nodeOf(guard, 'demands.query')),
    },
    context: nodeOf(guard, 'context'),
    rejections: sortedCodes((guard.rejections ?? []).map(({ code }) => code)),
  };
}
