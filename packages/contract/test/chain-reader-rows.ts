import type * as Internal from '../src/internal/index.ts';
import type { Defs, ObjectNode, Refusal, SchemaNode, Snapshot } from '../src/internal/index.ts';
import type { ChainReader, ChainReaderOf, Same } from './chain-readers.ts';

type Deep = { a: { b: { c: { d: { e: { defs: Defs } } } } } };

/** Functions of every kind `ChainReaderOf` judges: four hold a chain in a parameter or a result, the others do not. */
declare const candidates: {
  readerOfSnapshot(snapshot: Snapshot): number;
  readerOfMember(node: ObjectNode): number;
  readerOfDefsSixLevelsDown(deep: Deep): number;
  readerReturningNodes(text: string): readonly SchemaNode[];
  readerOfPartialDefs(defs: Readonly<Record<string, SchemaNode | undefined>>): number;
  refusalReader(refusal: Refusal<'no'>): number;
  countReader(count: number): number;
  unknownReader(value: unknown): number;
  // biome-ignore lint/suspicious/noExplicitAny: the row is that `any` is no chain
  anyReader(value: any): number;
};

type Found = ChainReaderOf<typeof candidates>;

/** The readers of a Snapshot, an `ObjectNode`, `defs` six levels down, a `SchemaNode[]` and a record of nodes are found. */
export const found: Record<Found, 0> = {
  readerOfDefsSixLevelsDown: 0,
  readerOfMember: 0,
  readerOfPartialDefs: 0,
  readerOfSnapshot: 0,
  readerReturningNodes: 0,
};

/** A `Refusal`, whose keys all hold `never`, is assignable to `Defs` and is no chain. */
// @ts-expect-error TS2353 refusalReader is no reader
export const refusalIsNoChain: Record<Found, 0> = { ...found, refusalReader: 0 };

/** A `number` is no chain. */
// @ts-expect-error TS2353 countReader is no reader
export const numberIsNoChain: Record<Found, 0> = { ...found, countReader: 0 };

/** `unknown` is no chain. */
// @ts-expect-error TS2353 unknownReader is no reader
export const unknownIsNoChain: Record<Found, 0> = { ...found, unknownReader: 0 };

/** `any` is no chain. */
// @ts-expect-error TS2353 anyReader is no reader
export const anyIsNoChain: Record<Found, 0> = { ...found, anyReader: 0 };

/** The derived set is exactly the 27 exports of `./internal` that read or make a chain. */
export const allReaders: Record<ChainReader, 0> = {
  brokerPlanOf: 0,
  canonicalSnapshotOf: 0,
  canonicalTextOf: 0,
  compatibilityReportOf: 0,
  decodeSnapshot: 0,
  defGraphOf: 0,
  defScopesOf: 0,
  exportedCodeOf: 0,
  exportedCutOf: 0,
  exportedEntryOf: 0,
  exportedSnapshotOf: 0,
  firstPublishChangesOf: 0,
  hashedTextOf: 0,
  headerValuesOf: 0,
  isEmptyTextPart: 0,
  isRemoved: 0,
  nestingFailureOf: 0,
  originPackagesOf: 0,
  ownRejectionsOf: 0,
  providedSnapshotOf: 0,
  publishedSnapshotOf: 0,
  reachedDefsOf: 0,
  snapshotOf: 0,
  textPartNodesOf: 0,
  textPartsOf: 0,
  validateRoot: 0,
  walkSchemas: 0,
};

/** The derived set is the same from eight levels down to twelve: a fixed point. */
export const eightIsTwelve: Same<
  ChainReaderOf<typeof Internal, 8>,
  ChainReaderOf<typeof Internal, 12>
> = true;

/** The derived set is already the same from two levels down. */
export const twoIsTwelve: Same<
  ChainReaderOf<typeof Internal, 2>,
  ChainReaderOf<typeof Internal, 12>
> = true;

/** One level misses a reader, so `Levels` is not vacuous. */
// @ts-expect-error TS2322 one level finds fewer readers than twelve
export const oneIsNotTwelve: Same<
  ChainReaderOf<typeof Internal, 1>,
  ChainReaderOf<typeof Internal, 12>
> = true;
