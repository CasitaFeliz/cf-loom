import type { StandardRejections } from '@casitafeliz/loom-contract';
import { deprecationHeaderOf, matchOf } from '@casitafeliz/loom-contract/internal';
import type { Issue } from '@casitafeliz/loom-handlers';
import { runEndpoint } from '@casitafeliz/loom-handlers/internal';
import { reservedResponseOf } from '../response/index.ts';
import type { LiveEndpoint, ServedContract, ServedEndpoint } from '../served/index.ts';
import { type Call, callOf, inputOf, type UnreadBody } from './call.ts';
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
  const url = new URL(request.url);
  const match = matchOf(served.endpoints, request.method, url.pathname);
  if (match.kind === 'none') {
    return { answered: { kind: 'fault', response: reservedResponseOf('NO_SUCH_ENDPOINT') } };
  }
  const endpoint = match.matched;
  switch (endpoint.kind) {
    case 'retired':
      return { endpoint, answered: { kind: 'fault', response: reservedResponseOf('RETIRED') } };
    case 'live': {
      const call = callOf(endpoint, request, { url, params: match.params });
      const answered = await answeredCallOf(call, served);
      return { endpoint, answered: withDeprecation(answered, endpoint) };
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
  switch (read.kind) {
    case 'too-large':
      return { kind: 'fault', response: reservedResponseOf('BODY_TOO_LARGE') };
    case 'malformed': {
      const issue: Issue = {
        part: 'input.body',
        path: [],
        code: 'malformed',
        message: read.message,
      };
      const faultedBy = { endpoint: call.endpoint.declared.name };
      return answeredOfInvalidInput([issue], faultedBy, standards);
    }
  }
}

/** Every response of a Deprecated Endpoint, whatever it answers, carries its `Deprecation` header. */
function withDeprecation(answered: Answered, endpoint: LiveEndpoint): Answered {
  if (endpoint.deprecatedAt !== undefined) {
    answered.response.headers.set('deprecation', deprecationHeaderOf(endpoint.deprecatedAt));
  }
  return answered;
}
