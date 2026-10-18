import { slotAt, type ValidatedGuard } from '../validation/index.ts';
import { sortedCodes } from './codes.ts';
import { declaredOriginOf, inMode, objectOf, type Sources } from './context.ts';
import type { GuardSnapshot } from './types.ts';

/**
 * The Guards the root reaches, by name: a Service's Endpoints attach them, directly or through a
 * Guard's `guards`; a Definitions Package reaches all of its own.
 */
export function guardsOf(
  guards: readonly ValidatedGuard[],
  sources: Sources,
): Readonly<Record<string, GuardSnapshot>> {
  const reached = guards.filter((located) => located.reached);
  return Object.fromEntries(
    reached.map((located) => [located.guard.name, guardOf(located, sources)]),
  );
}

function guardOf({ at, guard }: ValidatedGuard, { nodeAt, packages }: Sources): GuardSnapshot {
  return {
    origin: declaredOriginOf(packages, (definitions) => (definitions.guards ?? []).includes(guard)),
    guards: (guard.guards ?? []).map(({ name }) => name),
    qualifier: nodeAt(slotAt(at, 'qualifier')),
    demands: {
      headers: inMode(objectOf(nodeAt(slotAt(at, 'demands.headers'))), 'open'),
      query: objectOf(nodeAt(slotAt(at, 'demands.query'))),
    },
    context: nodeAt(slotAt(at, 'context')),
    rejections: sortedCodes((guard.rejections ?? []).map(({ code }) => code)),
  };
}
