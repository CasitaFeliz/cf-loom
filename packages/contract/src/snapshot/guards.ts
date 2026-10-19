import type { ValidatedGuard } from '../validation/index.ts';
import { sortedCodes } from './codes.ts';
import type { SnapshotSources } from './context.ts';
import { listedOriginOf } from './origins.ts';
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
    reached.map((located) => [located.guard.name, guardSnapshotOf(located, sources)]),
  );
}

function guardSnapshotOf(
  { guard, listedIn }: ValidatedGuard,
  { nodeOf, packages }: SnapshotSources,
): GuardSnapshot {
  return {
    origin: listedOriginOf(listedIn, packages),
    description: guard.description,
    guards: (guard.guards ?? []).map(({ name }) => name),
    qualifier: nodeOf(guard, 'qualifier') ?? null,
    demands: {
      headers: nodeOf(guard, 'demands.headers') ?? null,
      query: nodeOf(guard, 'demands.query') ?? null,
    },
    context: nodeOf(guard, 'context') ?? null,
    rejections: sortedCodes((guard.rejections ?? []).map(({ code }) => code)),
  };
}
