import type { Endpoint, InputOf, StandardRejections } from '@casitafeliz/loom-contract';
import type { ScriptedAnswer } from './answers.ts';
import type { StepBuilder } from './builder.ts';

/** One answer to one request, built with its builder, `r`, from the parsed Input; it may be async. */
export type Step<Target extends Endpoint, Standards extends StandardRejections> = (
  builder: StepBuilder<Target, Standards>,
  input: InputOf<Target>,
) => ScriptedAnswer | Promise<ScriptedAnswer>;

/**
 * How one Endpoint of a fake answers: each `once` step answers one request, in order, and then
 * the last `otherwise` answers every other.
 */
export type Script<Target extends Endpoint, Standards extends StandardRejections> = {
  once(step: Step<Target, Standards>): Script<Target, Standards>;
  otherwise(step: Step<Target, Standards>): Script<Target, Standards>;
};

/** A step as the fake runs it, whatever its Endpoint. */
export type AnyStep = Step<Endpoint, StandardRejections>;

/** A request's turn to take a step: after the requests that arrived before it took theirs. */
export type Turn = {
  readonly next: () => Promise<AnyStep | undefined>;
  readonly done: () => void;
};

/** One Endpoint's script, and the turns its requests take steps in, in the order they arrived. */
export type Scripted = {
  readonly script: Script<Endpoint, StandardRejections>;
  readonly turn: () => Turn;
  readonly wasScripted: () => boolean;
};

/** An Endpoint's script, empty: no step until a test adds one. */
export function scriptedOf(): Scripted {
  const onces: AnyStep[] = [];
  let otherwise: AnyStep | undefined;
  let scripted = false;
  let arrived: Promise<void> = Promise.resolve();
  const script: Script<Endpoint, StandardRejections> = {
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
    const next = async () => {
      await before;
      return onces.shift() ?? otherwise;
    };
    return { next, done: () => taken.resolve() };
  };
  return { script, turn, wasScripted: () => scripted };
}
