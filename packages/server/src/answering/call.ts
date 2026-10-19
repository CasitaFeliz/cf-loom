import {
  bodyOf,
  type TextSource,
  textPartsOf,
  textSourceOf,
} from '@casitafeliz/loom-contract/internal';
import type { LiveEndpoint } from '../served/index.ts';

/** One request to a live Endpoint: the Endpoint, the request, and where its text comes from. */
export type Call = {
  readonly endpoint: LiveEndpoint;
  readonly request: Request;
  readonly source: TextSource;
};

/** Why a body could not be read: too large to read, or no JSON. */
export type UnreadBody =
  | { readonly kind: 'too-large' }
  | { readonly kind: 'malformed'; readonly message: string };

/** The Endpoint's Input as the request carries it, or why its body could not be read. */
export type ReadInput =
  | { readonly kind: 'input'; readonly input: Readonly<Record<string, unknown>> }
  | UnreadBody;

/** A request to a live Endpoint, given its URL, parsed once, and the params its path matched. */
export function callOf(
  endpoint: LiveEndpoint,
  request: Request,
  matched: { readonly url: URL; readonly params: Readonly<Record<string, string>> },
): Call {
  return { endpoint, request, source: textSourceOf(request, matched.url, matched.params) };
}

/**
 * The Endpoint's Input: its text parts, and its body only when it declares one, read within the
 * limit; a body that cannot be read as JSON is the Input that cannot be read at all.
 */
export async function inputOf(call: Call, maxBodyBytes: number | undefined): Promise<ReadInput> {
  const text = textPartsOf(call.endpoint.nodes, call.source);
  if (!call.endpoint.readsBody) {
    return { kind: 'input', input: text };
  }
  const body = await bodyOf(call.request, maxBodyBytes);
  switch (body.kind) {
    case 'value':
      return { kind: 'input', input: { ...text, body: body.value } };
    case 'too-large':
    case 'malformed':
      return body;
  }
}
