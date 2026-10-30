import type { Endpoint } from '@cf-loom/contract';
import {
  jsonContentType,
  type PathSegment,
  pathSegmentsOf,
  segmentOf,
  unbrokenLineOf,
} from '@cf-loom/contract/internal';
import { type ParsedInput, textOf } from './input.ts';

/**
 * The URL a Provider is reached at, checked once: an http or https URL, its path kept as a prefix,
 * such as a gateway's mount; another scheme, a username or a password, which `fetch` refuses in a
 * URL, or a query or fragment, which no Endpoint's URL can carry, is a bug.
 */
export function baseUrlOf(baseUrl: string | URL): URL {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error(unbrokenLineOf(`The baseUrl's scheme ${base.protocol} is no http or https`));
  }
  if (base.username !== '' || base.password !== '') {
    const shown = `${base.protocol}//${base.host}${base.pathname}`;
    throw new Error(
      unbrokenLineOf(`The baseUrl ${shown} has a username or a password, which fetch refuses`),
    );
  }
  if (base.search !== '' || base.hash !== '' || /[?#]$/.test(base.href)) {
    throw new Error(
      unbrokenLineOf(`The baseUrl ${base.href} has a query or a fragment, which no Endpoint takes`),
    );
  }
  return base;
}

/** The base URL's path every Endpoint's path is called under, with one trailing slash removed. */
export function basePathOf(base: URL): string {
  return base.pathname.replace(/\/$/, '');
}

/** A parsed Input as the Request it travels in under the base URL; a redirect is never followed. */
export function requestOf(endpoint: Endpoint, base: URL, input: ParsedInput): Request {
  const url = new URL(base);
  url.pathname = `${basePathOf(base)}${pathOf(endpoint.path, input.params)}`;
  url.search = queryOf(input.query).toString();
  const headers = new Headers();
  for (const [name, text] of input.headers) {
    headers.set(name, text);
  }
  const { method } = endpoint;
  if (!('body' in input)) {
    return new Request(url, { method, headers, redirect: 'manual' });
  }
  headers.set('content-type', jsonContentType);
  const body = JSON.stringify(input.body);
  return new Request(url, { method, headers, body, redirect: 'manual' });
}

/** The declared path with each param's text percent-encoded as one segment. */
function pathOf(path: string, params: Readonly<Record<string, unknown>>): string {
  const segments = pathSegmentsOf(path).map((segment) => pathSegmentOf(segment, params));
  return `/${segments.join('/')}`;
}

function pathSegmentOf(segment: PathSegment, params: Readonly<Record<string, unknown>>): string {
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
