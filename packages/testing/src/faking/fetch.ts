import type { Fetch } from '@cf-loom/client';
import {
  invalidInputResponseOf,
  type Reading,
  readingOf,
  receivedBodyOf,
  textPartsOf,
  withDeprecation,
} from '@cf-loom/contract/internal';
import { responseOf } from '../answering/index.ts';
import { mistakeOf } from '../mistakes/index.ts';
import {
  type ListedEndpoint,
  type Matched,
  matchedOf,
  type Provided,
  whoOf,
} from '../provided/index.ts';
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
  readonly scriptedByNameOf: (name: string) => Scripted;
};

/** A fake with no script and no call yet. */
export function fakingOf(provided: Provided): Faking {
  const scriptedByName = new Map<string, Scripted>();
  const scripted = (name: string): Scripted => {
    const found = scriptedByName.get(name) ?? scriptedOf();
    scriptedByName.set(name, found);
    return found;
  };
  return { provided, calls: callLogOf(), scriptedByNameOf: scripted };
}

/**
 * The fake's `fetch`: each request answered as its Provider would, or aborted by its signal; one
 * already aborted is refused before anything is read, recorded or taken.
 */
export function fakeFetchOf(faking: Faking): Fetch {
  return async (url, init) => {
    init.signal?.throwIfAborted();
    const request = new Request(url, init);
    return await abortableOf(fakeResponseOf(faking, request), request.signal);
  };
}

/**
 * One request top to bottom: matched to a listed Endpoint, then answered, with `Deprecation` when
 * that Endpoint is Deprecated, whatever it answers.
 */
async function fakeResponseOf(faking: Faking, request: Request): Promise<Response> {
  const matched = matchedOf(faking.provided, request);
  const response = await answeredOf(faking, matched, request);
  return withDeprecation(response, matched.listed.deprecatedAt);
}

/** A request read as its Provider reads it and answered by the invalid-input Rejection, or its step. */
async function answeredOf(faking: Faking, matched: Matched, request: Request): Promise<Response> {
  const taken = await takenOf(faking, matched, request);
  if (taken.kind === 'answered') {
    return taken.response;
  }
  const scripted = await stepAnswerOf(taken.step, matched.listed, taken.input);
  return responseOf(answerOf(scripted), matched);
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
 * A request's place kept among its Endpoint's calls from its arrival, then its step taken once
 * every request that arrived before it took its own, and its call recorded; the step runs after,
 * so a slow step holds no other back. One aborted before it takes its step records nothing.
 */
async function takenOf(faking: Faking, matched: Matched, request: Request): Promise<Taken> {
  const { listed } = matched;
  const { signal } = request;
  const slot = faking.calls.arrived(listed.name);
  const scripted = faking.scriptedByNameOf(listed.name);
  const turn = scripted.turn();
  try {
    const reading = await abortableOf(readingOfRequest(matched, request), signal);
    if (reading.kind === 'stopped') {
      return reading.answer;
    }
    if (reading.kind === 'invalid') {
      signal.throwIfAborted();
      slot.fill(reading);
      const response = invalidInputResponseOf(reading.issues, listed.standards);
      return { kind: 'answered', response };
    }
    const step = await turn.next(signal);
    slot.fill(reading);
    if (step === undefined) {
      throw mistakeOf({ ...whoOf(listed), what: missingStepOf(scripted, listed) });
    }
    return { kind: 'step', step, input: reading.input };
  } finally {
    turn.done();
  }
}

/** A request read as its Provider reads it, every Guard admitting: a step answers for them. */
function readingOfRequest({ listed, source }: Matched, request: Request): Promise<Reading> {
  return readingOf(listed.endpoint, {
    textOf: () => textPartsOf(listed.nodes, source),
    body: () => receivedBodyOf(request),
  });
}

function missingStepOf(scripted: Scripted, listed: ListedEndpoint): string {
  if (!scripted.wasScripted()) {
    return `it was never scripted: on('${listed.name}') gives it steps`;
  }
  return 'no step is left and no otherwise answers';
}

/** What a step answered, given the builder and the parsed Input; anything else is the test's mistake. */
async function stepAnswerOf(
  step: AnyStep,
  listed: ListedEndpoint,
  input: Readonly<Record<string, unknown>>,
): Promise<ScriptedAnswer> {
  let isAnswer: boolean;
  let returned: unknown;
  try {
    returned = await step(stepBuilder, input);
    isAnswer = isScriptedAnswer(returned);
  } catch (e) {
    throw mistakeOf({ ...whoOf(listed), what: 'a step threw', cause: e });
  }
  if (!isAnswer) {
    throw mistakeOf({ ...whoOf(listed), what: 'a step returned no answer built with its r' });
  }
  return returned as ScriptedAnswer;
}

/**
 * What a request waits for, or the signal's reason, as `fetch` rejects with it, once the signal
 * is aborted; it is never already aborted here, since `request.signal` follows `init.signal`, which
 * `fetch` checked first.
 */
function abortableOf<Value>(waited: Promise<Value>, signal: AbortSignal): Promise<Value> {
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const settled = Promise.race([waited, aborted.promise]);
  return settled.finally(() => signal.removeEventListener('abort', abort));
}
