import type { Endpoint } from '@casitafeliz/loom-contract';
import type { ResolvedOutcome } from '@casitafeliz/loom-handlers';
import { runEndpoint } from '@casitafeliz/loom-handlers/internal';
import { matchOf } from '../matching/index.ts';
import { type ResolvedSuccess, reservedResponseOf, withDeprecation } from '../response/index.ts';
import type { ServedContract, ServedEndpoint } from '../served/index.ts';
import { type Call, callOf, inputOf, type Reading } from './call.ts';
import { admittedOf } from './guards.ts';
import {
  type Answered,
  answeredOfFailedRun,
  answeredOfNotSuccess,
  answeredOfSuccess,
} from './runs.ts';

/** How a request was answered, and the declared Endpoint it matched, if any. */
export type AnsweredFor = { readonly endpoint?: ServedEndpoint; readonly answered: Answered };

/** One request answered: matched to its Endpoint, then its Guards, its Input and its Handler. */
export async function answerOf(
  served: ServedContract,
  request: Request,
  maxBodyBytes: number | undefined,
): Promise<AnsweredFor> {
  const match = matchOf(served.endpoints, request.method, new URL(request.url).pathname);
  if (match.kind === 'none') {
    return { answered: { kind: 'fault', response: reservedResponseOf('NO_SUCH_ENDPOINT') } };
  }
  const endpoint = match.route;
  switch (endpoint.kind) {
    case 'retired':
      return { endpoint, answered: { kind: 'fault', response: reservedResponseOf('RETIRED') } };
    case 'live': {
      const call = callOf(endpoint, request, match.params);
      const answered = await answeredCallOf(call, { standards: served.standards, maxBodyBytes });
      const response = withDeprecation(answered.response, endpoint.deprecatedAt);
      return { endpoint, answered: { ...answered, response } };
    }
  }
}

async function answeredCallOf(call: Call, reading: Reading): Promise<Answered> {
  const admitted = await admittedOf(call, reading.standards);
  if (admitted.kind === 'answered') {
    return admitted.answered;
  }
  const input = await inputOf(call, reading);
  if (input.kind === 'answered') {
    return input.answered;
  }
  const given = { input: input.input, context: admitted.context };
  const run = await runEndpoint(call.endpoint.handler, given, reading.standards);
  const party = { endpoint: call.endpoint.endpoint.name };
  if (run.kind !== 'answered') {
    return answeredOfFailedRun(run, party, reading.standards);
  }
  return answeredOfOutcome(run.answer, party);
}

function answeredOfOutcome(
  outcome: ResolvedOutcome<Endpoint>,
  party: { readonly endpoint: string },
): Answered {
  if (outcome.kind === 'success') {
    return answeredOfSuccess(outcome as ResolvedSuccess);
  }
  return answeredOfNotSuccess(outcome, party);
}
