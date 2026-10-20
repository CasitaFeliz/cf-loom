import type { Endpoint, StandardRejections } from '@casitafeliz/loom-contract';
import {
  matchOf,
  type Reading,
  type ReadingSource,
  readingOf,
  reservedResponseOf,
  withDeprecation,
} from '@casitafeliz/loom-contract/internal';
import type { Fault } from '@casitafeliz/loom-handlers';
import { type EndpointRun, notRunFaultOf, runEndpoint } from '@casitafeliz/loom-handlers/internal';
import type { ServedContract, ServedEndpoint } from '../served/index.ts';
import { type Call, partsOf } from './call.ts';
import { guardRunsOf } from './guards.ts';
import type { FaultedBy } from './hooks.ts';
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
  const faultedBy = { endpoint: call.endpoint.declared.name };
  const runs = guardRunsOf(call, served.standards);
  const source = { ...partsOf(call, served), admit: runs.admit };
  const reading = await readingOrThrownOf(call.endpoint.declared, source);
  switch (reading.kind) {
    case 'stopped':
      return reading.answer;
    case 'thrown':
      return answeredOfFailedRun(reading, faultedBy, served.standards);
    case 'invalid':
      return answeredOfInvalidInput(reading.issues, faultedBy, served.standards);
    case 'input': {
      const given = { input: reading.input, context: runs.context() };
      const run = await runEndpoint(call.endpoint.handler, given, served.standards);
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
  return answeredOfNotSuccess(outcome, faultedBy);
}
