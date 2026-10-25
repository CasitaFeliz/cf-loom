import type { AnyDependency, ListedEndpoint, ListedName } from '@cf-loom/client/internal';
import type { InputOf } from '@cf-loom/contract';
import type { ScriptedAnswer } from './answers.ts';
import type { AnyStepBuilder, StepBuilder } from './builder.ts';

/** One answer to one request of a listed Endpoint, built with its `r` from the parsed Input; it may be async. */
export type Step<D extends AnyDependency, Name extends ListedName<D>> = (
  builder: StepBuilder<D, Name>,
  input: InputOf<ListedEndpoint<D, Name>>,
) => ScriptedAnswer | Promise<ScriptedAnswer>;

/**
 * How one listed Endpoint of a fake answers: each `once` step answers one request, in order, and
 * then the last `otherwise` answers every other.
 */
export type Script<D extends AnyDependency, Name extends ListedName<D>> = {
  once(step: Step<D, Name>): Script<D, Name>;
  otherwise(step: Step<D, Name>): Script<D, Name>;
};

/** A step as the fake runs it, whatever its Endpoint. */
export type AnyStep = (
  builder: AnyStepBuilder,
  input: Readonly<Record<string, unknown>>,
) => ScriptedAnswer | Promise<ScriptedAnswer>;

/** A script as the fake keeps it, whatever its Endpoint; `on(name)` types it. */
export type AnyScript = {
  once(step: AnyStep): AnyScript;
  otherwise(step: AnyStep): AnyScript;
};

/**
 * A request's turn to take a step: after the requests that arrived before it took theirs, and
 * never once its signal is aborted.
 */
export type Turn = {
  readonly next: (signal: AbortSignal) => Promise<AnyStep | undefined>;
  readonly done: () => void;
};

/** One Endpoint's script, and the turns its requests take steps in, in the order they arrived. */
export type Scripted = {
  readonly script: AnyScript;
  readonly turn: () => Turn;
  readonly wasScripted: () => boolean;
};

/** An Endpoint's script, empty: no step until a test adds one. */
export function scriptedOf(): Scripted {
  const onces: AnyStep[] = [];
  let otherwise: AnyStep | undefined;
  let scripted = false;
  let arrived: Promise<void> = Promise.resolve();
  const script: AnyScript = {
    once: (step) => {
      scripted = true;
      onces.push(step);
      return script;
    },
    otherwise: (step) => {
      scripted = true;
      otherwise = step;
      return script;
    },
  };
  const turn = (): Turn => {
    const before = arrived;
    const taken = Promise.withResolvers<void>();
    arrived = before.then(() => taken.promise);
    const next = async (signal: AbortSignal) => {
      await before;
      signal.throwIfAborted();
      return onces.shift() ?? otherwise;
    };
    return { next, done: () => taken.resolve() };
  };
  return { script, turn, wasScripted: () => scripted };
}
