import type { StandardRejections } from '@casitafeliz/loom-contract';
import { matchOf, reservedResponseOf, withDeprecation } from '@casitafeliz/loom-contract/internal';
import { runEndpoint } from '@casitafeliz/loom-handlers/internal';
import type { ServedContract, ServedEndpoint } from '../served/index.ts';
import { type Call, inputOf, type UnreadBody } from './call.ts';
import { admittedOf } from './guards.ts';
import {
  type Answered,
  answeredOfFailedRun,
  answeredOfInvalidInput,
  answeredOfNotSuccess,
  answeredOfSuccess,
} from './runs.ts';

/** How a request was answered, and the declared Endpoint it matched, if any. */
export type AnsweredFor = { readonly endpoint?: ServedEndpoint; readonly answered: Answered };

/** One request answered: matched to its Endpoint, then its Guards, its Input and its Handler. */
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
  const admitted = await admittedOf(call, served.standards);
  if (admitted.kind === 'answered') {
    return admitted.answered;
  }
  const read = await inputOf(call, served.maxBodyBytes);
  if (read.kind !== 'input') {
    return answeredOfUnread(read, call, served.standards);
  }
  const given = { input: read.input, context: admitted.context };
  const run = await runEndpoint(call.endpoint.handler, given, served.standards);
  const faultedBy = { endpoint: call.endpoint.declared.name };
  if (run.kind !== 'answered') {
    return answeredOfFailedRun(run, faultedBy, served.standards);
  }
  const outcome = run.answer;
  if (outcome.kind === 'success') {
    return answeredOfSuccess(outcome, faultedBy);
  }
  return answeredOfNotSuccess(outcome, faultedBy);
}

/** A body that could not be read, answered alone: too large unread, or not JSON. */
function answeredOfUnread(read: UnreadBody, call: Call, standards: StandardRejections): Answered {
  if (read.kind === 'too-large') {
    return { kind: 'fault', response: reservedResponseOf('BODY_TOO_LARGE') };
  }
  const faultedBy = { endpoint: call.endpoint.declared.name };
  return answeredOfInvalidInput([read.issue], faultedBy, standards);
}
