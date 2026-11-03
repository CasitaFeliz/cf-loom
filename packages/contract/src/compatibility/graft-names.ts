import { type Defs, defGraphOf } from '../walker/index.ts';
import type { GraftRecord } from './graft-record.ts';
import { pairsFindingRemovedField } from './pair-closure.ts';

/**
 * The name each def source takes, in the order the sources are met: none for a pair that grafts
 * no field and reaches no def named apart, which is held as the Snapshot declares it; every other
 * def takes the name of the def it comes from, or that name with `~1`, `~2`…, the first the
 * Snapshot's defs and the names before it leave free. A recursion id never holds `~`, so none
 * collides with a declared one.
 */
export function defNamesOf(record: GraftRecord, declared: Defs): readonly (string | undefined)[] {
  const apart = pairsFindingRemovedField(record.walked);
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  const graph = defGraphOf(declared);
  const isTaken = (name: string) => graph.def(name) !== undefined || used.has(name);
  return record.sources.all.map((source) => {
    if (source.kind === 'pair' && !apart.has(source.end.met)) {
      return undefined;
    }
    const name = freeNameOf(source.base, { isTaken, nextSuffix });
    used.add(name);
    return name;
  });
}

/** The name a def comes from if free, else that name with the first free suffix, `~1`, `~2`…, tried from the one after the last the base took, since no name is ever freed. */
function freeNameOf(
  base: string,
  names: {
    readonly isTaken: (name: string) => boolean;
    readonly nextSuffix: Map<string, number>;
  },
): string {
  if (!names.isTaken(base)) {
    return base;
  }
  let suffix = names.nextSuffix.get(base) ?? 1;
  while (names.isTaken(`${base}~${suffix}`)) {
    suffix++;
  }
  names.nextSuffix.set(base, suffix + 1);
  return `${base}~${suffix}`;
}
