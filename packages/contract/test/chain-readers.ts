import type * as Internal from '../src/internal/index.ts';
import type {
  Defs,
  ExportedCut,
  ExportedSnapshot,
  PublishedSnapshot,
  SchemaNode,
  Snapshot,
  ValidRoot,
} from '../src/internal/index.ts';

/** What a chain of recursion ids is held in, once a command has read the author's Root. */
type ChainContainer =
  | Snapshot
  | PublishedSnapshot
  | ExportedSnapshot
  | ExportedCut
  | ValidRoot
  | Defs
  | SchemaNode;

/** Whether `Left` and `Right` are the same type: each is assignable to the other. */
export type Same<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

/**
 * Whether `Value` is one of the holder types, or one member of their unions, and not only
 * assignable to one: a type whose keys all hold `never`, such as a Refusal, is assignable to `Defs`.
 */
type IsHolder<Value> = true extends (
  ChainContainer extends infer Holder
    ? Holder extends unknown
      ? Same<Value, Holder>
      : never
    : never
)
  ? true
  : false;

/**
 * Whether a value of type `Value` holds a chain, as itself or in a field, an item or a variant, up
 * to `Levels` levels down; the set of readers is the same from two levels to twelve.
 */
type HoldsChain<Value, Levels extends number, Depth extends unknown[] = []> = 0 extends 1 & Value
  ? false
  : unknown extends Value
    ? false
    : Value extends unknown
      ? IsHolder<Value> extends true
        ? true
        : Depth['length'] extends Levels
          ? false
          : Value extends (...args: never[]) => unknown
            ? false
            : Value extends readonly (infer Item)[]
              ? HoldsChain<Item, Levels, [...Depth, 0]>
              : Value extends object
                ? true extends {
                    [Key in keyof Value]-?: HoldsChain<Value[Key], Levels, [...Depth, 0]>;
                  }[keyof Value]
                  ? true
                  : false
                : false
      : never;

/** Whether a function reads a chain: one of its parameters, or what it returns, holds one. */
type ReadsChain<Function, Levels extends number> = Function extends (
  ...args: infer Parameters
) => infer Returned
  ? true extends
      | { [Key in keyof Parameters]: HoldsChain<Parameters[Key], Levels> }[number]
      | HoldsChain<Awaited<Returned>, Levels>
    ? true
    : false
  : false;

/** The exports of a module that read a chain or make one, looking `Levels` levels down. */
export type ChainReaderOf<Exports, Levels extends number = 8> = {
  [Name in keyof Exports]: ReadsChain<Exports[Name], Levels> extends true ? Name : never;
}[keyof Exports];

/** Every export of `./internal` that reads a chain or makes one: a command's stage, or a call one makes. */
export type ChainReader = ChainReaderOf<typeof Internal>;
