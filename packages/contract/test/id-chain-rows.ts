import { z } from 'zod';
import type { Same } from './chain-readers.ts';
import type { ChainTable, IdChain } from './id-chain-type.ts';
import { chainsByType, type HolderType } from './id-chains.ts';

/** A node type that holds a schema must list a chain. */
// @ts-expect-error TS2322 a union with no chain
export const holderWithoutChain = { ...chainsByType, union: [] } as const satisfies ChainTable;

/** A leaf must list none. */
// @ts-expect-error TS2322 a string with a chain
export const leafWithChain = { ...chainsByType, string: [{}] } as const satisfies ChainTable;

/** Every node type needs its key. */
const { json: _json, ...withoutJson } = chainsByType;
// @ts-expect-error TS2741 no json key
export const missingKey = withoutJson satisfies ChainTable;

/** A key that is no node type is refused. */
// @ts-expect-error TS2353 an alias is no node type
export const extraKey = { ...chainsByType, alias: [] } as const satisfies ChainTable;

/** The node types a chain's file is named for are the ones that hold a schema. */
export const holderTypes: Same<
  HolderType,
  'object' | 'record' | 'array' | 'tuple' | 'union' | 'tagged' | 'allOf' | 'ref'
> = true;

/** A leaf is no holder type. */
// @ts-expect-error TS2322 a string node holds no schema
export const leafIsNoHolder: HolderType = 'string';

/** A chain on one cycle through its first link has no link to start from. */
export const groupWithStart: IdChain = {
  name: 'x',
  wayOfHolding: 'x',
  holds: 1,
  cycle: 'group',
  linkOf: (previous) => previous,
  // @ts-expect-error TS2353 a group chain takes no startOf
  startOf: () => z.string(),
};

const holdingBackLink = (previous: z.ZodType, self: () => z.ZodType) => z.union([previous, self()]);

/** A chain on one cycle through its first link has no link being made to hold back. */
// @ts-expect-error TS2322 a group chain's linkOf takes the previous link only
export const groupWithSelf: IdChain = {
  name: 'x',
  wayOfHolding: 'x',
  holds: 1,
  cycle: 'group',
  linkOf: holdingBackLink,
};
