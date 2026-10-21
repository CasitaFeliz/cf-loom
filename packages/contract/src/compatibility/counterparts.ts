import { byCodePoint } from '../walker/index.ts';

/** What a key of two maps holds: on one side only, or on both. */
export type Counterpart<Baseline, Proposed = Baseline> =
  | { readonly kind: 'added'; readonly key: string; readonly proposed: Proposed }
  | { readonly kind: 'removed'; readonly key: string; readonly baseline: Baseline }
  | {
      readonly kind: 'kept';
      readonly key: string;
      readonly baseline: Baseline;
      readonly proposed: Proposed;
    };

/** Every key of the Baseline's map and the proposed one, in code point order, with what each holds. */
export function counterpartsOf<Baseline, Proposed = Baseline>(
  baseline: Readonly<Record<string, Baseline>>,
  proposed: Readonly<Record<string, Proposed>>,
): readonly Counterpart<Baseline, Proposed>[] {
  const before = new Map(Object.entries(baseline));
  const after = new Map(Object.entries(proposed));
  const keys = new Set([...before.keys(), ...after.keys()]);
  const counterparts: Counterpart<Baseline, Proposed>[] = [];
  for (const key of [...keys].sort(byCodePoint)) {
    const counterpart = counterpartOf(key, before.get(key), after.get(key));
    if (counterpart !== undefined) {
      counterparts.push(counterpart);
    }
  }
  return counterparts;
}

function counterpartOf<Baseline, Proposed>(
  key: string,
  baseline: Baseline | undefined,
  proposed: Proposed | undefined,
): Counterpart<Baseline, Proposed> | undefined {
  if (baseline !== undefined && proposed !== undefined) {
    return { kind: 'kept', key, baseline, proposed };
  }
  if (proposed !== undefined) {
    return { kind: 'added', key, proposed };
  }
  return baseline === undefined ? undefined : { kind: 'removed', key, baseline };
}
