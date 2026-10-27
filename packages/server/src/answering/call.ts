import {
  bodyOf,
  type ReadingSource,
  type TextSource,
  textPartsOf,
} from '@cf-loom/contract/internal';
import type { HandledRequest } from '@cf-loom/handlers';
import type { LiveEndpoint, ServedContract } from '../served/index.ts';
import { type Answered, reservedAnsweredOf } from './runs.ts';

/** One request to a live Endpoint: the Endpoint, the request, and where its text comes from. */
export type Call = {
  readonly endpoint: LiveEndpoint;
  readonly request: Request;
  readonly source: TextSource;
};

/** What a Handler is given of a request beside its Input: its signal and its headers, as received. */
export function handledRequestOf({ signal, headers }: Request): HandledRequest {
  return { signal, headers };
}

/**
 * Where `serve` reads a request's parts from: each party's text by its walked nodes, and the body
 * within `maxBodyBytes`, one too large answered unread.
 */
export function partsOf(
  call: Call,
  served: Pick<ServedContract, 'nodes' | 'maxBodyBytes'>,
): Omit<ReadingSource<Answered>, 'admit'> {
  return {
    textOf: (party) => textPartsOf(served.nodes.get(party) ?? {}, call.source),
    body: async () => {
      const body = await bodyOf(call.request, served.maxBodyBytes);
      if (body.kind === 'too-large') {
        return { kind: 'stopped', answer: reservedAnsweredOf('BODY_TOO_LARGE') };
      }
      return body;
    },
  };
}
