import {
  bodyOf,
  type ReadingSource,
  reservedResponseOf,
  type TextSource,
  textPartsOf,
} from '@casitafeliz/loom-contract/internal';
import type { LiveEndpoint, ServedContract } from '../served/index.ts';
import type { Answered } from './runs.ts';

/** One request to a live Endpoint: the Endpoint, the request, and where its text comes from. */
export type Call = {
  readonly endpoint: LiveEndpoint;
  readonly request: Request;
  readonly source: TextSource;
};

/**
 * Where `serve` reads a request's parts from: each party's text by its walked nodes, and the body
 * within `maxBodyBytes`, one too large answered unread.
 */
export function partsOf(
  call: Call,
  served: ServedContract,
): Omit<ReadingSource<Answered>, 'admit'> {
  return {
    textOf: (party) => textPartsOf(served.nodes.get(party) ?? {}, call.source),
    body: async () => {
      const body = await bodyOf(call.request, served.maxBodyBytes);
      if (body.kind === 'too-large') {
        const response = reservedResponseOf('BODY_TOO_LARGE');
        return { kind: 'stopped', answer: { kind: 'fault', response } };
      }
      return body;
    },
  };
}
