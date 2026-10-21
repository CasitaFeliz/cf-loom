import { byCodePoint } from '../walker/index.ts';

/** What a key of two maps holds: on one side only, or on both. */
export type Counterpart<Value> =
  | { readonly kind: 'added'; readonly key: string; readonly proposed: Value }
  | { readonly kind: 'removed'; readonly key: string; readonly baseline: Value }
  | {
      readonly kind: 'kept';
      readonly key: string;
      readonly baseline: Value;
      readonly proposed: Value;
    };

/** Every key of the Baseline's map and the proposed one, in code point order, with what each holds. */
export function counterpartsOf<Value>(
  baseline: Readonly<Record<string, Value>>,
  proposed: Readonly<Record<string, Value>>,
): readonly Counterpart<Value>[] {
  const before = new Map(Object.entries(baseline));
  const after = new Map(Object.entries(proposed));
  const keys = new Set([...before.keys(), ...after.keys()]);
  const counterparts: Counterpart<Value>[] = [];
  for (const key of [...keys].sort(byCodePoint)) {
    const counterpart = counterpartOf(key, before.get(key), after.get(key));
    if (counterpart !== undefined) {
      counterparts.push(counterpart);
    }
  }
  return counterparts;
}

function counterpartOf<Value>(
  key: string,
  baseline: Value | undefined,
  proposed: Value | undefined,
): Counterpart<Value> | undefined {
  if (baseline !== undefined && proposed !== undefined) {
    return { kind: 'kept', key, baseline, proposed };
  }
  if (proposed !== undefined) {
    return { kind: 'added', key, proposed };
  }
  return baseline === undefined ? undefined : { kind: 'removed', key, baseline };
}
