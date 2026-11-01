import type { ChainReader } from './chain-readers.ts';
import type { IdChain } from './id-chain-type.ts';

/** One call a command makes on a chain, its input read through `inputOf` in `callOf`, before the timed part. */
export type ChainStage = {
  readonly name: string;
  /** The call to time on a chain of `count` links, its input built outside it. */
  readonly callOf: (chain: IdChain, count: number) => () => unknown;
  /** What the call gives on the large chain, asserted before its growth. */
  readonly checkOf: (given: unknown, count: number) => void;
};

/** The stages of the readers a command runs, by reader. */
export type StagesOf<Reader extends ChainReader> = {
  readonly [Name in Reader]: readonly [ChainStage, ...ChainStage[]];
};

/** Why a reader of a chain is no stage of this family. */
export type NoStage = { readonly reason: string };

/** A stage whose check is typed by what its call gives. */
export function stage<Given>(
  name: string,
  callOf: (chain: IdChain, count: number) => () => Given,
  checkOf: (given: Given, count: number) => void,
): ChainStage {
  return { name, callOf, checkOf: (given, count) => checkOf(given as Given, count) };
}

/** How many defs a Snapshot's text holds. */
export function defsOfText(text: string): number {
  return Object.keys(JSON.parse(text).defs).length;
}
