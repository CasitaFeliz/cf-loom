import { z } from 'zod';
import { defineEndpoint, defineGroup, defineService } from '../src/index.ts';
import {
  canonicalTextOf,
  decodeSnapshot,
  failureLineOf,
  type PublishedServiceSnapshot,
  publishedSnapshotOf,
  type ServiceSnapshot,
  snapshotOf,
  validateRoot,
} from '../src/internal/index.ts';
import { headOf } from './chain-heads.ts';
import type { IdChain } from './id-chain-type.ts';
import { aRootPackage } from './root-package.ts';
import { publishedAt } from './snapshots.ts';

/** The Endpoint every chain's Root declares, as the Snapshot identifies it. */
export const identity = 'POST /echo';

/** The Endpoint that takes `body` as its Input body and answers nothing. */
export function anEchoTaking(body: z.ZodType) {
  return defineEndpoint({
    name: 'echo',
    method: 'POST',
    path: '/echo',
    visibility: 'public',
    description: 'Echo',
    input: { body },
    success: { status: 204 },
  });
}

/**
 * What an Endpoint's body holds of a chain's head: `top`, and for a Baseline also the optional
 * `gone`, the head itself or an object of a field for each link, each holding the head; or only
 * `top`, whose innermost object also holds the optional `lost`.
 */
type Field = 'top' | 'top-and-gone' | 'top-and-fan' | 'top-with-lost';

function bodyHolding(top: z.ZodType, field: Field, count: number) {
  switch (field) {
    case 'top':
    case 'top-with-lost':
      return z.object({ top });
    case 'top-and-gone':
      return z.object({ top, gone: top.optional() });
    case 'top-and-fan': {
      const fan = Array.from({ length: count }, (_, link): [string, z.ZodType] => [
        `f${link}`,
        top,
      ]);
      return z.object({ top, gone: z.object(Object.fromEntries(fan)).optional() });
    }
  }
}

/** The Root whose one Endpoint takes the chain's head as `top`, and, for the Baseline, also as the optional `gone`. */
export function aRootHolding(chain: IdChain, count: number, field: Field) {
  const top = headOf(chain, count, field === 'top-with-lost' ? { lost: true } : {});
  const body = bodyHolding(top, field, count);
  const group = defineGroup({
    name: 'shapes',
    description: 'Shapes',
    endpoints: [anEchoTaking(body)],
  });
  return defineService({ name: 'shapes-service', groups: [group] });
}

function declaredBy(chain: IdChain, count: number, field: Field): ServiceSnapshot {
  const root = aRootHolding(chain, count, field);
  const validated = validateRoot(root, aRootPackage(root));
  if (validated.kind !== 'valid') {
    throw new Error(validated.failures.slice(0, 1).map(failureLineOf).join(''));
  }
  return snapshotOf(validated) as ServiceSnapshot;
}

function changedAtLink0(declared: ServiceSnapshot): ServiceSnapshot {
  const { link0 } = declared.defs;
  if (link0 === undefined) {
    throw new Error('The chain declares no link0.');
  }
  return { ...declared, defs: { ...declared.defs, link0: { ...link0, description: 'changed' } } };
}

function decodedFrom(text: string): PublishedServiceSnapshot {
  const decoded = decodeSnapshot(text);
  if (decoded.kind !== 'decoded') {
    throw new Error(`The text is not a Snapshot: ${decoded.kind}.`);
  }
  return decoded.snapshot as PublishedServiceSnapshot;
}

/** Every state a command reads a chain in, in the order the commands make them. */
type ChainStates = {
  /** What `generate` declares. */
  readonly declared: ServiceSnapshot;
  /** What a first `publish` writes. */
  readonly firstText: string;
  /** The first version, decoded: the Baseline of an unchanged chain. */
  readonly same: PublishedServiceSnapshot;
  /** A decoded Baseline whose Input also held the field `gone`. */
  readonly baseline: PublishedServiceSnapshot;
  /** The declared Snapshot with a Neutral change at link 0. */
  readonly changed: ServiceSnapshot;
  /** The declared Snapshot merged on that Baseline, which holds one Former Input. */
  readonly grafted: PublishedServiceSnapshot;
  /** The grafted version's text. */
  readonly graftedText: string;
  /** The grafted version, decoded: a Baseline holding a Former Input. */
  readonly graftedBaseline: PublishedServiceSnapshot;
};

/** The states a command reads a chain in, as `inputOf` names them. */
export type ChainState = keyof ChainStates;

function statesOf(chain: IdChain, count: number): ChainStates {
  const declared = declaredBy(chain, count, 'top');
  const before = declaredBy(chain, count, 'top-and-gone');
  const firstText = canonicalTextOf(publishedSnapshotOf(undefined, declared, publishedAt('1.0.0')));
  const baseline = decodedFrom(
    canonicalTextOf(publishedSnapshotOf(undefined, before, publishedAt('1.0.0'))),
  );
  const grafted = publishedSnapshotOf(baseline, declared, publishedAt('1.1.0'));
  const graftedText = canonicalTextOf(grafted);
  return {
    declared,
    firstText,
    same: decodedFrom(firstText),
    baseline,
    changed: changedAtLink0(declared),
    grafted,
    graftedText,
    graftedBaseline: decodedFrom(graftedText),
  };
}

/** What a Baseline whose removed field is a fan of the chain's head has to publish onto, and the result's text. */
type FannedStates = {
  /** The first version, decoded, whose Input also held the field `gone`: an object of a field for each link, each holding the head. */
  readonly baseline: PublishedServiceSnapshot;
  /** The declared Snapshot without `gone`. */
  readonly declared: ServiceSnapshot;
  /** The text of the declared Snapshot merged on that Baseline, which holds one Former Input. */
  readonly graftedText: string;
};

function fannedStatesOf(chain: IdChain, count: number): FannedStates {
  const before = declaredBy(chain, count, 'top-and-fan');
  const baselineText = canonicalTextOf(
    publishedSnapshotOf(undefined, before, publishedAt('1.0.0')),
  );
  const baseline = decodedFrom(baselineText);
  const declared = declaredBy(chain, count, 'top');
  const graftedText = canonicalTextOf(
    publishedSnapshotOf(baseline, declared, publishedAt('1.1.0')),
  );
  return { baseline, declared, graftedText };
}

/** What a Baseline whose head held a field the declared Snapshot lacks, in the innermost object of the chain, has to publish onto. */
type LostStates = {
  /** The first version, decoded, whose head also held the field `lost`: every link's closure changed. */
  readonly baseline: PublishedServiceSnapshot;
  /** The declared Snapshot, which lacks `lost`. */
  readonly declared: ServiceSnapshot;
  /** The text of the declared Snapshot merged on that Baseline, whose Former Input, where the chain holds one, names every link apart. */
  readonly graftedText: string;
};

function lostStatesOf(chain: IdChain, count: number): LostStates {
  const before = declaredBy(chain, count, 'top-with-lost');
  const baselineText = canonicalTextOf(
    publishedSnapshotOf(undefined, before, publishedAt('1.0.0')),
  );
  const baseline = decodedFrom(baselineText);
  const declared = declaredBy(chain, count, 'top');
  const graftedText = canonicalTextOf(
    publishedSnapshotOf(baseline, declared, publishedAt('1.1.0')),
  );
  return { baseline, declared, graftedText };
}

const statesBuilt = new Map<IdChain, Map<number, ChainStates>>();
const fannedBuilt = new Map<IdChain, Map<number, FannedStates>>();
const lostBuilt = new Map<IdChain, Map<number, LostStates>>();

/** The states of a chain at a size, built on the first ask and kept in `cache`. */
function builtIn<States>(
  cache: Map<IdChain, Map<number, States>>,
  [chain, count]: readonly [IdChain, number],
  build: (chain: IdChain, count: number) => States,
): States {
  const bySize = cache.get(chain) ?? new Map<number, States>();
  cache.set(chain, bySize);
  const known = bySize.get(count);
  if (known !== undefined) {
    return known;
  }
  const made = build(chain, count);
  bySize.set(count, made);
  return made;
}

/**
 * A run's own copy of one state of a chain at a size, as `orderOf` asks; `forgetChain` drops a
 * chain's states.
 */
export function inputOf<State extends ChainState>(
  chain: IdChain,
  count: number,
  state: State,
): ChainStates[State] {
  return structuredClone(builtIn(statesBuilt, [chain, count], statesOf)[state]);
}

/** A run's own copy of the states of a Baseline whose removed field is a fan of the chain's head, as `orderOf` asks. */
export function fannedInputOf(chain: IdChain, count: number): FannedStates {
  return structuredClone(builtIn(fannedBuilt, [chain, count], fannedStatesOf));
}

/** A run's own copy of the states of a Baseline whose head held a field the declared Snapshot lacks, as `orderOf` asks. */
export function lostInputOf(chain: IdChain, count: number): LostStates {
  return structuredClone(builtIn(lostBuilt, [chain, count], lostStatesOf));
}

/** Drops every state built for the chain, so the next chain's rows start with the memory free. */
export function forgetChain(chain: IdChain): void {
  statesBuilt.delete(chain);
  fannedBuilt.delete(chain);
  lostBuilt.delete(chain);
}

/** How many links the chains are compared at to tell the Snapshots they declare apart. */
const linksCompared = 3;

/**
 * The chains grouped by the Snapshot they declare at a few links, in the order given: chains in one
 * group declare one Snapshot, so everything after `generate` is timed once for the group.
 */
export function groupedByDeclaredSnapshot<Chain extends IdChain>(
  chains: readonly Chain[],
): Chain[][] {
  const groups = new Map<string, Chain[]>();
  for (const chain of chains) {
    const key = JSON.stringify(inputOf(chain, linksCompared, 'declared'));
    groups.set(key, [...(groups.get(key) ?? []), chain]);
    forgetChain(chain);
  }
  return [...groups.values()];
}
