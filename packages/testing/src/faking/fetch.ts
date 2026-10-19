import type { Fetch } from '@casitafeliz/loom-client';
import { invalidInputResponseOf, withDeprecation } from '@casitafeliz/loom-contract/internal';
import { responseOf } from '../answering/index.ts';
import { mistakeOf } from '../mistakes/index.ts';
import { type ListedEndpoint, type Matched, matchedOf, type Provided } from '../provided/index.ts';
import { receivedOf } from '../receiving/index.ts';
import {
  type AnyStep,
  answerOf,
  isScriptedAnswer,
  type Scripted,
  type ScriptedAnswer,
  scriptedOf,
  stepBuilder,
} from '../scripting/index.ts';
import { type CallLog, callLogOf } from './calls.ts';

/** One fake's state: its Provider, each listed Endpoint's script, and the calls it received. */
export type Faking = {
  readonly provided: Provided;
  readonly calls: CallLog;
  readonly scriptedOf: (name: string) => Scripted;
};

/** A fake with no script and no call yet. */
export function fakingOf(provided: Provided): Faking {
  const scriptedByName = new Map<string, Scripted>();
  const scripted = (name: string): Scripted => {
    const found = scriptedByName.get(name) ?? scriptedOf();
    scriptedByName.set(name, found);
    return found;
  };
  return { provided, calls: callLogOf(), scriptedOf: scripted };
}

/** The fake's `fetch`: each request answered as its Provider would, or aborted by its signal. */
export function fakeFetchOf(faking: Faking): Fetch {
  return (url, init) => abortableOf(fakeResponseOf(faking, new Request(url, init)), init.signal);
}

/**
 * One request top to bottom: matched to a listed Endpoint, read as its Provider reads it and
 * answered by the invalid-input Rejection, or by the step it takes in the order it arrived.
 */
async function fakeResponseOf(faking: Faking, request: Request): Promise<Response> {
  const matched = matchedOf(faking.provided, request);
  const taken = await takenOf(faking, matched, request);
  if (taken.kind === 'answered') {
    return taken.response;
  }
  const scripted = await scriptedAnswerOf(taken.step, matched.listed, taken.input);
  return responseOf(answerOf(scripted), matched.listed);
}

/** What a request takes: the invalid-input Rejection, or its step and its parsed Input. */
type Taken =
  | { readonly kind: 'answered'; readonly response: Response }
  | {
      readonly kind: 'step';
      readonly step: AnyStep;
      readonly input: Readonly<Record<string, unknown>>;
    };

/**
 * A request's call recorded in the order it arrived, then its step taken once every request that
 * arrived before it took its own; the step runs after, so a slow step holds no other back.
 */
async function takenOf(faking: Faking, matched: Matched, request: Request): Promise<Taken> {
  const { listed, source } = matched;
  const slot = faking.calls.arrived(listed.name);
  const scripted = faking.scriptedOf(listed.name);
  const turn = scripted.turn();
  try {
    const received = await receivedOf(listed, request, source);
    slot.fill(received);
    if (received.kind === 'invalid') {
      const response = invalidInputResponseOf(received.issues, listed.standards);
      return { kind: 'answered', response: withDeprecation(response, listed.deprecatedAt) };
    }
    const step = await turn.next();
    if (step === undefined) {
      throw mistakeOf({ ...whoOf(listed), what: missingStepOf(scripted, listed) });
    }
    return { kind: 'step', step, input: received.input };
  } finally {
    turn.done();
  }
}

function missingStepOf(scripted: Scripted, listed: ListedEndpoint): string {
  if (!scripted.wasScripted()) {
    return `it was never scripted: on('${listed.name}') gives it steps`;
  }
  return 'no step is left and no otherwise answers';
}

/** What a step answered, given the builder and the parsed Input; anything else is the test's mistake. */
async function scriptedAnswerOf(
  step: AnyStep,
  listed: ListedEndpoint,
  input: Readonly<Record<string, unknown>>,
): Promise<ScriptedAnswer> {
  let returned: unknown;
  try {
    returned = await step(stepBuilder, input);
  } catch (e) {
    throw mistakeOf({ ...whoOf(listed), what: 'a step threw', cause: e });
  }
  if (!isScriptedAnswer(returned)) {
    throw mistakeOf({ ...whoOf(listed), what: 'a step returned no answer built with its r' });
  }
  return returned;
}

function whoOf(listed: ListedEndpoint): { readonly provider: string; readonly endpoint: string } {
  return { provider: listed.provider, endpoint: listed.name };
}

/** A response, or the signal's reason, as `fetch` rejects with it, once the signal is aborted. */
function abortableOf(
  responding: Promise<Response>,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (signal === null || signal === undefined) {
    return responding;
  }
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  if (signal.aborted) {
    abort();
  }
  signal.addEventListener('abort', abort, { once: true });
  const settled = Promise.race([responding, aborted.promise]);
  return settled.finally(() => signal.removeEventListener('abort', abort));
}
