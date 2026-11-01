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

/** The Root whose one Endpoint takes the chain's head as `top`, and, for the Baseline, also as the optional `gone`. */
export function aRootHolding(chain: IdChain, count: number, field: 'top' | 'top-and-gone') {
  const top = headOf(chain, count);
  const body = field === 'top' ? z.object({ top }) : z.object({ top, gone: top.optional() });
  const group = defineGroup({
    name: 'shapes',
    description: 'Shapes',
    endpoints: [anEchoTaking(body)],
  });
  return defineService({ name: 'shapes-service', groups: [group] });
}

function declaredBy(chain: IdChain, count: number, field: 'top' | 'top-and-gone'): ServiceSnapshot {
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

const statesBuilt = new Map<IdChain, Map<number, ChainStates>>();

function builtStatesOf(chain: IdChain, count: number): ChainStates {
  const bySize = statesBuilt.get(chain) ?? new Map<number, ChainStates>();
  statesBuilt.set(chain, bySize);
  const known = bySize.get(count);
  if (known !== undefined) {
    return known;
  }
  const built = statesOf(chain, count);
  bySize.set(count, built);
  return built;
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
  return structuredClone(builtStatesOf(chain, count)[state]);
}

/** Drops every state built for the chain, so the next chain's rows start with the memory free. */
export function forgetChain(chain: IdChain): void {
  statesBuilt.delete(chain);
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
