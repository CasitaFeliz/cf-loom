import type { StandardRejections } from '@casitafeliz/loom-contract';
import {
  matchOf,
  type Reading,
  readingOf,
  reservedResponseOf,
  withDeprecation,
} from '@casitafeliz/loom-contract/internal';
import { fault } from '@casitafeliz/loom-handlers';
import { type EndpointGiven, runEndpoint } from '@casitafeliz/loom-handlers/internal';
import type { ServedContract, ServedEndpoint } from '../served/index.ts';
import { type Call, partsOf } from './call.ts';
import { type GuardRuns, guardRunsOf } from './guards.ts';
import {
  type Answered,
  answeredOfFailedRun,
  answeredOfInvalidInput,
  answeredOfNotSuccess,
  answeredOfSuccess,
} from './runs.ts';

/** How a request was answered, and the declared Endpoint it matched, if any. */
export type AnsweredFor = { readonly endpoint?: ServedEndpoint; readonly answered: Answered };

/** One request answered: matched to its Endpoint, read with its Guards' runs, then its Handler. */
export async function answerOf(served: ServedContract, request: Request): Promise<AnsweredFor> {
  const match = matchOf(served.endpoints, request);
  if (match.kind === 'none') {
    return { answered: { kind: 'fault', response: reservedResponseOf('NO_SUCH_ENDPOINT') } };
  }
  const endpoint = match.matched;
  switch (endpoint.kind) {
    case 'retired':
      return { endpoint, answered: { kind: 'fault', response: reservedResponseOf('RETIRED') } };
    case 'live': {
      const answered = await answeredCallOf({ endpoint, request, source: match.source }, served);
      withDeprecation(answered.response, endpoint.deprecatedAt);
      return { endpoint, answered };
    }
  }
}

async function answeredCallOf(call: Call, served: ServedContract): Promise<Answered> {
  const runs = guardRunsOf(call, served.standards);
  const reading = await readingOrThrownOf(call, served, runs.admit);
  switch (reading.kind) {
    case 'stopped':
      return reading.answer;
    case 'invalid': {
      const faultedBy = { endpoint: call.endpoint.declared.name };
      return answeredOfInvalidInput(reading.issues, faultedBy, served.standards);
    }
    case 'input': {
      const given = { input: reading.input, context: runs.context() };
      return await answeredRunOf(call, given, served.standards);
    }
  }
}

/**
 * The request read with its Guards' runs; a throw while parsing it, such as a stack overflow on
 * deeply nested Input, is answered as a Handler's throw would be, not committed, since none ran.
 */
async function readingOrThrownOf(
  call: Call,
  served: ServedContract,
  admit: GuardRuns['admit'],
): Promise<Reading<Answered>> {
  try {
    return await readingOf(call.endpoint.declared, { ...partsOf(call, served), admit });
  } catch (e) {
    const thrown = fault({ committed: 'no', retryable: false, cause: e });
    const faultedBy = { endpoint: call.endpoint.declared.name };
    const answer = answeredOfFailedRun(
      { kind: 'thrown', fault: thrown },
      faultedBy,
      served.standards,
    );
    return { kind: 'stopped', answer };
  }
}

/** The EndpointHandler's run on the parsed Input and the admitted Context, answered. */
async function answeredRunOf(
  call: Call,
  given: EndpointGiven,
  standards: StandardRejections,
): Promise<Answered> {
  const run = await runEndpoint(call.endpoint.handler, given, standards);
  const faultedBy = { endpoint: call.endpoint.declared.name };
  if (run.kind !== 'answered') {
    return answeredOfFailedRun(run, faultedBy, standards);
  }
  const outcome = run.answer;
  if (outcome.kind === 'success') {
    return answeredOfSuccess(outcome, faultedBy);
  }
  return answeredOfNotSuccess(outcome, faultedBy);
}
