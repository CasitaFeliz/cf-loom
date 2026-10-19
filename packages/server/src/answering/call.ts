import type { StandardRejections } from '@casitafeliz/loom-contract';
import { bodyOf, type TextSource, textPartsOf } from '../request/index.ts';
import { reservedResponseOf } from '../response/index.ts';
import type { LiveEndpoint } from '../served/index.ts';
import { type Answered, answeredOfInvalidInput } from './runs.ts';

/** One request to a live Endpoint: the Endpoint, the request, and where its text comes from. */
export type Call = {
  readonly endpoint: LiveEndpoint;
  readonly request: Request;
  readonly source: TextSource;
};

/** What `serve` was told about reading a request: the Standard Rejections and the body limit. */
export type Reading = {
  readonly standards: StandardRejections;
  readonly maxBodyBytes: number | undefined;
};

/** The Endpoint's Input as the request carries it, or the answer when its body cannot be read. */
export type Input =
  | { readonly kind: 'input'; readonly input: Readonly<Record<string, unknown>> }
  | { readonly kind: 'answered'; readonly answered: Answered };

/** A request to a live Endpoint, its params by name from the texts matched in path order. */
export function callOf(endpoint: LiveEndpoint, request: Request, params: readonly string[]): Call {
  const url = new URL(request.url);
  const names = endpoint.segments.filter((segment) => segment.kind === 'param');
  const named = names.map((segment, index) => [segment.name, params[index] ?? ''] as const);
  const source = {
    params: Object.fromEntries(named),
    query: url.searchParams,
    headers: request.headers,
  };
  return { endpoint, request, source };
}

/**
 * The Endpoint's Input: its text parts, and its body only when it declares one; a body that cannot
 * be read as JSON is answered alone, since the Input cannot be read, and one too large unread.
 */
export async function inputOf(call: Call, reading: Reading): Promise<Input> {
  const text = textPartsOf(call.endpoint.nodes, call.source);
  if (!call.endpoint.readsBody) {
    return { kind: 'input', input: text };
  }
  const body = await bodyOf(call.request, reading.maxBodyBytes);
  switch (body.kind) {
    case 'value':
      return { kind: 'input', input: { ...text, body: body.value } };
    case 'too-large':
      return answered({ kind: 'fault', response: reservedResponseOf('BODY_TOO_LARGE') });
    case 'malformed': {
      const issue = {
        part: 'input.body',
        path: [],
        code: 'malformed',
        message: body.message,
      } as const;
      const party = { endpoint: call.endpoint.endpoint.name };
      return answered(answeredOfInvalidInput([issue], party, reading.standards));
    }
  }
}

function answered(answer: Answered): Input {
  return { kind: 'answered', answered: answer };
}
