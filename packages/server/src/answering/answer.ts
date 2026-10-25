import type { Endpoint, Http, StandardRejections } from '@cf-loom/contract';
import {
  type Match,
  matchOf,
  methodNotAllowedResponseOf,
  type Reading,
  type ReadingSource,
  readingOf,
  withDeprecation,
} from '@cf-loom/contract/internal';
import type { Fault } from '@cf-loom/handlers';
import { type EndpointRun, notRunFaultOf, runEndpoint } from '@cf-loom/handlers/internal';
import type { ServedContract, ServedEndpoint } from '../served/index.ts';
import { type Call, handledRequestOf, partsOf } from './call.ts';
import { fallbackAnswerOf } from './fallback.ts';
import { guardRunsOf } from './guards.ts';
import type { FaultedBy } from './hooks.ts';
import {
  type Answered,
  answeredOfFailedRun,
  answeredOfInvalidInput,
  answeredOfNotSuccess,
  answeredOfSuccess,
  reservedAnsweredOf,
} from './runs.ts';

/**
 * How a request was answered, and the declared Endpoint it matched, if any; or the fallback's
 * Response, which is not `serve`'s answer.
 */
export type AnsweredFor =
  | { readonly kind: 'served'; readonly endpoint?: ServedEndpoint; readonly answered: Answered }
  | { readonly kind: 'fallback'; readonly response: Response };

/**
 * One request answered: matched to its Endpoint, read with its Guards' runs, then its Handler;
 * one no declared Endpoint matches goes to the fallback when there is one.
 */
export async function answerOf(
  served: ServedContract,
  request: Request,
  fallback: Http | undefined,
): Promise<AnsweredFor> {
  const match = matchOf(served.endpoints, request);
  if (match.kind !== 'matched' && fallback !== undefined) {
    return { kind: 'fallback', response: await fallbackAnswerOf(fallback, request) };
  }
  switch (match.kind) {
    case 'none':
      return { kind: 'served', answered: reservedAnsweredOf('NO_SUCH_ENDPOINT') };
    case 'other-method': {
      const response = methodNotAllowedResponseOf(match.allowed);
      return { kind: 'served', answered: reservedAnsweredOf('METHOD_NOT_ALLOWED', response) };
    }
    case 'matched':
      return await matchedAnswerOf(served, match, request);
  }
}

/** A request a declared Endpoint matched: `RETIRED`, or its call answered. */
async function matchedAnswerOf(
  served: ServedContract,
  { matched: endpoint, source }: Extract<Match<ServedEndpoint>, { readonly kind: 'matched' }>,
  request: Request,
): Promise<AnsweredFor> {
  switch (endpoint.kind) {
    case 'retired': {
      return { kind: 'served', endpoint, answered: reservedAnsweredOf('RETIRED') };
    }
    case 'live': {
      const answered = await answeredCallOf({ endpoint, request, source }, served);
      withDeprecation(answered.response, endpoint.deprecatedAt);
      return { kind: 'served', endpoint, answered };
    }
  }
}

async function answeredCallOf(call: Call, served: ServedContract): Promise<Answered> {
  const { declared } = call.endpoint;
  const faultedBy = { element: declared, identity: declared.name };
  const runs = guardRunsOf(call, served);
  const source = { ...partsOf(call, served), admit: runs.admit };
  const reading = await readingOrThrownOf(declared, source);
  switch (reading.kind) {
    case 'stopped':
      return reading.answer;
    case 'thrown':
      return answeredOfFailedRun(reading, faultedBy, served.standards);
    case 'invalid':
      return answeredOfInvalidInput(reading.issues, faultedBy, served.standards);
    case 'input': {
      const given = {
        input: reading.input,
        context: runs.context(),
        request: handledRequestOf(call.request),
        resources: served.resources,
      };
      const run = await runEndpoint(call.endpoint.handler, given);
      return answeredRunOf(run, faultedBy, served.standards);
    }
  }
}

/**
 * The request read with its Guards' runs; a throw while parsing it, such as a stack overflow on
 * deeply nested Input, is a throw before any Handler ran.
 */
async function readingOrThrownOf(
  endpoint: Endpoint,
  source: ReadingSource<Answered>,
): Promise<Reading<Answered> | { readonly kind: 'thrown'; readonly fault: Fault }> {
  try {
    return await readingOf(endpoint, source);
  } catch (e) {
    return { kind: 'thrown', fault: notRunFaultOf(e) };
  }
}

/** The EndpointHandler's run answered: its Outcome, or what it did not answer. */
function answeredRunOf(
  run: EndpointRun,
  faultedBy: FaultedBy,
  standards: StandardRejections,
): Answered {
  if (run.kind !== 'answered') {
    return answeredOfFailedRun(run, faultedBy, standards);
  }
  const outcome = run.answer;
  if (outcome.kind === 'success') {
    return answeredOfSuccess(outcome);
  }
  return answeredOfNotSuccess(outcome, faultedBy, standards);
}
