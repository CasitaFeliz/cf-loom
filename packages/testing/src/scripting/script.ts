import type { AnyDependency, ListedEndpoint, ListedName } from '@cf-loom/client/internal';
import type { InputOf } from '@cf-loom/contract';
import type { ScriptedAnswer } from './answers.ts';
import type { StepBuilder } from './builder.ts';

/** One answer to one request of a listed Endpoint, built with its builder from the parsed Input; it may be async. */
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
export type AnyStep = Step<AnyDependency, ListedName<AnyDependency>>;

/** A script as the fake keeps it, whatever its Endpoint; `on(name)` types it. */
export type AnyScript = Script<AnyDependency, ListedName<AnyDependency>>;

/**
 * A request's turn to take a step: after the requests that arrived before it took theirs, and
 * never once its signal is aborted.
 */
export type Turn = {
  readonly next: (signal: AbortSignal) => Promise<AnyStep | undefined>;
  readonly done: () => void;
};

/** What an Endpoint's script has met: the requests that took a turn, the once steps added, and those no request took. */
export type Tally = {
  readonly requests: number;
  readonly onces: number;
  readonly unused: number;
};

/** One Endpoint's script, and the turns its requests take steps in, in the order they arrived. */
export type Scripted = {
  readonly script: AnyScript;
  readonly turn: () => Turn;
  readonly wasScripted: () => boolean;
  readonly tally: () => Tally;
};

/** A number of once steps in words: `1 once step`, `2 once steps`. */
export function onceStepsOf(count: number): string {
  return `${count} once step${count === 1 ? '' : 's'}`;
}

/** An Endpoint's script, empty: no step until a test adds one. */
export function scriptedOf(): Scripted {
  const onces: AnyStep[] = [];
  let otherwise: AnyStep | undefined;
  let scripted = false;
  let added = 0;
  let requests = 0;
  let arrived: Promise<void> = Promise.resolve();
  const script: AnyScript = {
    once: (step) => {
      scripted = true;
      added += 1;
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
      requests += 1;
      return onces.shift() ?? otherwise;
    };
    return { next, done: () => taken.resolve() };
  };
  const tally = () => ({ requests, onces: added, unused: onces.length });
  return { script, turn, wasScripted: () => scripted, tally };
}
