import type { ValidatedGuard } from '../validation/index.ts';
import { sortedCodes } from './codes.ts';
import type { SnapshotSources } from './context.ts';
import { textPartOf } from './input.ts';
import { packageOriginOf } from './origins.ts';
import type { GuardSnapshot } from './types.ts';

/**
 * The Guards the Root reaches, by name: a Service's Endpoints attach them, directly or through a
 * Guard's `guards`; a Definitions Package's are those it exports and those they reach.
 */
export function guardSnapshotsOf(
  guards: readonly ValidatedGuard[],
  sources: SnapshotSources,
): Readonly<Record<string, GuardSnapshot>> {
  return Object.fromEntries(
    guards.map((located) => [located.guard.name, guardSnapshotOf(located, sources)]),
  );
}

function guardSnapshotOf(
  { guard, from }: ValidatedGuard,
  { nodeOf }: SnapshotSources,
): GuardSnapshot {
  return {
    origin: packageOriginOf(from),
    description: guard.description,
    guards: (guard.guards ?? []).map(({ name }) => name),
    qualifier: nodeOf(guard, 'qualifier') ?? null,
    demands: {
      headers: textPartOf(nodeOf(guard, 'demands.headers')),
      query: textPartOf(nodeOf(guard, 'demands.query')),
    },
    context: nodeOf(guard, 'context') ?? null,
    rejections: sortedCodes((guard.rejections ?? []).map(({ code }) => code)),
  };
}
