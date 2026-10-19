import type { Endpoint } from '@casitafeliz/loom-contract';
import {
  jsonContentType,
  type PathSegment,
  pathSegmentsOf,
  segmentOf,
} from '@casitafeliz/loom-contract/internal';
import { type ParsedInput, textOf } from './input.ts';

/** What `fetch` is called with: the URL and the init, the signal left to the caller. */
export type Sending = { readonly url: string; readonly init: RequestInit };

/**
 * The URL a Provider is reached at, checked once: its path is kept as a prefix, such as a
 * gateway's mount, and a query or fragment, which no Endpoint's URL can carry, is a bug.
 */
export function baseUrlOf(baseUrl: string | URL): URL {
  const base = new URL(baseUrl);
  if (base.search !== '' || base.hash !== '' || /[?#]$/.test(base.href)) {
    throw new Error(`The baseUrl ${base.href} has a query or a fragment, which no Endpoint takes`);
  }
  return base;
}

/** A parsed Input as it travels to its Endpoint under the base URL. */
export function sendingOf(endpoint: Endpoint, base: URL, input: ParsedInput): Sending {
  const url = new URL(base);
  url.pathname = `${base.pathname.replace(/\/$/, '')}${pathOf(endpoint.path, input.params)}`;
  url.search = queryOf(input.query).toString();
  const headers = new Headers();
  for (const [name, text] of input.headers) {
    headers.set(name, text);
  }
  if (!('body' in input)) {
    return { url: url.href, init: { method: endpoint.method, headers } };
  }
  headers.set('content-type', jsonContentType);
  const body = JSON.stringify(input.body);
  return { url: url.href, init: { method: endpoint.method, headers, body } };
}

/** The declared path with each param's text percent-encoded as one segment. */
function pathOf(path: string, params: Readonly<Record<string, unknown>>): string {
  const segments = pathSegmentsOf(path).map((segment) => segmentTextOf(segment, params));
  return `/${segments.join('/')}`;
}

function segmentTextOf(segment: PathSegment, params: Readonly<Record<string, unknown>>): string {
  switch (segment.kind) {
    case 'literal':
      return segment.text;
    case 'param':
      return segmentOf(textOf(params[segment.name]));
  }
}

/** The query, a list as its key repeated once per item. */
function queryOf(query: Readonly<Record<string, unknown>>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    const values: readonly unknown[] = Array.isArray(value) ? value : [value];
    for (const item of values) {
      search.append(name, textOf(item));
    }
  }
  return search;
}
