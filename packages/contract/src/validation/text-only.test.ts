import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { summarized } from '../../test/failures.ts';
import { orderOf, orders } from '../../test/growth.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
  openEnum,
} from '../index.ts';
import {
  headerTextsOf,
  isQueryText,
  isSegmentText,
  type Root,
  textOfValue,
  textPartsOf,
  validateRoot,
} from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

/** A headers object whose names the types cannot judge, as a cast lets an author write it. */
function headersOf(shape: Record<string, core.$ZodType>) {
  return z.object(shape) as z.ZodObject;
}

/** A 401 Rejection declaring the headers it is given, whose names the types cannot judge. */
function aRejectionWith(headers: z.ZodObject) {
  return defineRejection({
    code: 'UNAUTHENTICATED',
    status: 401,
    message: 'Unauthenticated',
    headers,
  });
}

function rootOf(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return defineService({ name: 'orders-service', groups: [orders] });
}

function validateEndpoint(endpoint: Endpoint) {
  return validateInPackage(rootOf(endpoint));
}

function failed(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

const endpointAt = 'endpoints.GET /orders (listOrders)';
const text = 'travels as text: a string, number, boolean, literal or enum';

describe('validateRoot: text-only headers, query and path params', () => {
  test('strings, numbers, booleans, literals and enums validate in every text part', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderId/items/:itemId',
      input: {
        params: z.object({ orderId: z.uuid(), itemId: z.int() }),
        query: z.object({
          page: z.int().optional(),
          dryRun: z.boolean(),
          kind: z.literal('all'),
          status: openEnum(['pending', 'paid']),
          ids: z.array(z.uuid()),
        }),
        headers: z.object({ 'x-tenant': z.string(), 'x-retries': z.number() }),
      },
      success: { ...listing.success, headers: z.object({ 'x-total': z.int() }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('a header that is an object fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-client': z.object({ id: z.string() }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(`${endpointAt} input.headers.x-client`, 'not-text', `A header ${text}: x-client`),
    );
  });

  test('a header that is a list fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-tags': z.array(z.string()) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(`${endpointAt} input.headers.x-tags`, 'not-text', `A header ${text}: x-tags`),
    );
  });

  test('a Success header that is an object fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      success: { ...listing.success, headers: z.object({ 'x-page': z.object({ next: z.int() }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(`${endpointAt} success.headers.x-page`, 'not-text', `A header ${text}: x-page`),
    );
  });

  test('a Rejection header that is an object fails', () => {
    const rejection = aRejectionWith(z.object({ 'x-realm': z.object({ id: z.string() }) }));

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed('codes.UNAUTHENTICATED headers.x-realm', 'not-text', `A header ${text}: x-realm`),
    );
  });

  test('a Rejection header that is a list fails', () => {
    const rejection = aRejectionWith(z.object({ 'x-realms': z.array(z.string()) }));

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed('codes.UNAUTHENTICATED headers.x-realms', 'not-text', `A header ${text}: x-realms`),
    );
  });

  test('a nullable Rejection header fails', () => {
    const rejection = aRejectionWith(z.object({ 'x-realm': z.string().nullable() }));

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(
        'codes.UNAUTHENTICATED headers.x-realm',
        'nullable-text',
        'A header is never nullable: x-realm',
      ),
    );
  });

  test('a Rejection header of a text type validates', () => {
    const rejection = aRejectionWith(
      z.object({ 'www-authenticate': z.string(), 'retry-after': z.int().optional() }),
    );

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] })).kind).toBe(
      'valid',
    );
  });

  test('a query param that is an object fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ filter: z.object({ status: z.string() }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.filter`,
        'not-text',
        `A query param ${text}, or a list of those: filter`,
      ),
    );
  });

  test('a query param that is a list of objects fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ filters: z.array(z.object({ status: z.string() })) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.filters`,
        'not-text',
        `A query param ${text}, or a list of those: filters`,
      ),
    );
  });

  test('a path param that is a list fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.array(z.string()) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        'endpoints.GET /orders/{} (listOrders) input.params.orderId',
        'not-text',
        `A path param ${text}: orderId`,
      ),
    );
  });

  test('a nullable query param fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ page: z.int().nullable() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.page`,
        'nullable-text',
        'A query param is never nullable: page',
      ),
    );
  });

  test('a nullable path param fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid().nullable() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        'endpoints.GET /orders/{} (listOrders) input.params.orderId',
        'nullable-text',
        'A path param is never nullable: orderId',
      ),
    );
  });

  test('a nullable header fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-tenant': z.string().nullable() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-tenant`,
        'nullable-text',
        'A header is never nullable: x-tenant',
      ),
    );
  });

  test('a Guard’s demanded header that is an object fails', () => {
    const signed = defineGuard({
      name: 'signed',
      description: 'A signed request',
      demands: { headers: z.object({ 'x-signature': z.object({ alg: z.string() }) }) },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [signed] }))).toEqual(
      failed(
        'guards.signed demands.headers.x-signature',
        'not-text',
        `A header ${text}: x-signature`,
      ),
    );
  });

  test('a headers part that is not an object fails', () => {
    const headers = z.string() as unknown as z.ZodObject;

    expect(validateEndpoint(defineEndpoint({ ...listing, input: { headers } }))).toEqual(
      failed(
        `${endpointAt} input.headers`,
        'not-an-object-schema',
        'headers is an object of its fields',
      ),
    );
  });
});

describe('validateRoot: a text part that is itself nullable', () => {
  test('a nullable headers object fails', () => {
    const headers = z.object({ 'x-tenant': z.string() }).nullable() as unknown as z.ZodObject;

    expect(validateEndpoint(defineEndpoint({ ...listing, input: { headers } }))).toEqual(
      failed(`${endpointAt} input.headers`, 'nullable-text', 'headers is never nullable'),
    );
  });

  test('a nullable query object fails', () => {
    const query = z.object({ page: z.int() }).nullable() as unknown as z.ZodObject;

    expect(validateEndpoint(defineEndpoint({ ...listing, input: { query } }))).toEqual(
      failed(`${endpointAt} input.query`, 'nullable-text', 'query is never nullable'),
    );
  });
});

describe('validateRoot: header names', () => {
  test('an upper-case Input header name fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: headersOf({ 'X-Tenant': z.string() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.X-Tenant`,
        'header-names',
        'Header names are lower-case: X-Tenant',
      ),
    );
  });

  test('an upper-case Success header name fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      success: { ...listing.success, headers: headersOf({ 'Content-Location': z.string() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} success.headers.Content-Location`,
        'header-names',
        'Header names are lower-case: Content-Location',
      ),
    );
  });

  test('an upper-case Rejection header name fails', () => {
    const rejection = aRejectionWith(headersOf({ 'WWW-Authenticate': z.string() }));

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(
        'codes.UNAUTHENTICATED headers.WWW-Authenticate',
        'header-names',
        'Header names are lower-case: WWW-Authenticate',
      ),
    );
  });

  test('an upper-case demanded header name fails', () => {
    const apiKey = defineGuard({
      name: 'apiKey',
      description: 'A key',
      demands: { headers: headersOf({ 'X-Api-Key': z.string() }) },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [apiKey] }))).toEqual(
      failed(
        'guards.apiKey demands.headers.X-Api-Key',
        'header-names',
        'Header names are lower-case: X-Api-Key',
      ),
    );
  });
});

/** An Endpoint declaring one header name where a header can be declared: Input, Success, a Rejection or a Guard's demands. */
const headerPositions = {
  input: (name: string) =>
    defineEndpoint({ ...listing, input: { headers: headersOf({ [name]: z.string() }) } }),
  success: (name: string) =>
    defineEndpoint({
      ...listing,
      success: { ...listing.success, headers: headersOf({ [name]: z.string() }) },
    }),
  rejection: (name: string) =>
    defineEndpoint({ ...listing, rejections: [aRejectionWith(headersOf({ [name]: z.string() }))] }),
  demands: (name: string) =>
    defineEndpoint({
      ...listing,
      guards: [
        defineGuard({
          name: 'apiKey',
          description: 'A key',
          demands: { headers: headersOf({ [name]: z.string() }) },
        }),
      ],
    }),
} as const;

const positions = Object.keys(headerPositions) as (keyof typeof headerPositions)[];
const requestPositions = ['input', 'demands'] as const;
const responsePositions = ['success', 'rejection'] as const;

/** The names the Fetch standard forbids in a request by name alone, copied from its source as an oracle. */
const fetchForbiddenRequestNames = [
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
];

/** Names under the two prefixes the Fetch standard keeps, `proxy-` and `sec-`. */
const fetchForbiddenRequestPrefixed = [
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-x',
  'proxy-authorization',
  'proxy-connection',
];

/** Names that merely contain a reserved prefix's letters. */
const nearPrefixNames = ['secret', 'x-sec-id', 'proxy', 'x-proxy-id'];

const bodyAndCfLoomNames = ['content-type', 'content-encoding', 'content-range', 'deprecation'];

const hostOwnedResponseNames = [
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-connection',
  'upgrade',
  'te',
  'trailer',
  'host',
  ...bodyAndCfLoomNames,
];

const browserHiddenResponseNames = ['set-cookie', 'set-cookie2'];

/** Reserved in a request and free in a response. */
const requestOnlyNames = [
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'origin',
  'referer',
  'via',
  'sec-fetch-site',
  'sec-x',
  'proxy-authorization',
];

const notTokens = ['x y', 'héader', 'a:b', '', 'x"y', 'x/y'];

const requestReserved = (name: string) => ({
  rule: 'header-names',
  message: `A request header the Fetch standard keeps for the user agent, or cf-loom owns, is reserved: ${name}`,
});

const responseReserved = (name: string) => ({
  rule: 'header-names',
  message: `A response header the host or cf-loom owns, or a browser hides, is reserved: ${name}`,
});

function crossed<Side extends string>(sides: readonly Side[], names: readonly string[]) {
  return sides.flatMap((side) => names.map((name) => [side, name] as const));
}

describe('validateRoot: header names are lower-case RFC 9110 tokens no other party owns', () => {
  test.each(crossed(requestPositions, fetchForbiddenRequestNames))(
    'a %s header named %s, which the Fetch standard keeps for the user agent, fails',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated).toMatchObject({ kind: 'invalid', failures: [requestReserved(name)] });
    },
  );

  test.each(crossed(requestPositions, fetchForbiddenRequestPrefixed))(
    'a %s header named %s, under a prefix the Fetch standard keeps, fails',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated).toMatchObject({ kind: 'invalid', failures: [requestReserved(name)] });
    },
  );

  test.each(crossed(requestPositions, nearPrefixNames))(
    'a %s header named %s, which only looks like a kept prefix, validates',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated.kind).toBe('valid');
    },
  );

  test.each(crossed(requestPositions, bodyAndCfLoomNames))(
    'a %s header named %s, which the body or cf-loom owns, fails',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated).toMatchObject({ kind: 'invalid', failures: [requestReserved(name)] });
    },
  );

  test.each(crossed(responsePositions, hostOwnedResponseNames))(
    'a %s header named %s, which the host or cf-loom owns, fails',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated).toMatchObject({ kind: 'invalid', failures: [responseReserved(name)] });
    },
  );

  test.each(crossed(responsePositions, browserHiddenResponseNames))(
    'a %s header named %s, which a browser hides, fails',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated).toMatchObject({ kind: 'invalid', failures: [responseReserved(name)] });
    },
  );

  test.each(crossed(responsePositions, requestOnlyNames))(
    'a %s header named %s, reserved only in requests, validates',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated.kind).toBe('valid');
    },
  );

  test.each(requestPositions)(
    'a %s header named set-cookie2, reserved only in responses, validates',
    (position) => {
      const validated = validateEndpoint(headerPositions[position]('set-cookie2'));

      expect(validated.kind).toBe('valid');
    },
  );

  test.each(positions.flatMap((position) => notTokens.map((name) => [position, name] as const)))(
    'a %s header named %j, which is no token, fails',
    (position, name) => {
      const validated = validateEndpoint(headerPositions[position](name));

      expect(validated).toMatchObject({
        kind: 'invalid',
        failures: [
          { rule: 'header-names', message: `A header name is an RFC 9110 token: ${name}` },
        ],
      });
    },
  );

  test.each(positions)('a %s header named content-location validates', (position) => {
    const validated = validateEndpoint(headerPositions[position]('content-location'));

    expect(validated.kind).toBe('valid');
  });
});

describe('validateRoot: one schema per header or query name on an Endpoint', () => {
  const userToken = defineGuard({
    name: 'userToken',
    description: 'A signed-in user',
    demands: {
      headers: z.object({ authorization: z.string() }),
      query: z.object({ tenant: z.string().optional() }),
    },
  });

  test('an Endpoint and its Guard declaring one header alike validate', () => {
    const endpoint = defineEndpoint({
      ...listing,
      guards: [userToken],
      input: {
        headers: z.object({ authorization: z.string().optional() }),
        query: z.object({ tenant: z.string() }),
      },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('an Endpoint and its Guard declaring one header with different schemas fail', () => {
    const endpoint = defineEndpoint({
      ...listing,
      guards: [userToken],
      input: { headers: z.object({ authorization: z.jwt() }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers`,
        'input-conflict',
        'A header has one schema across an Endpoint and its Guards: authorization differs between listOrders and userToken',
      ),
    );
  });

  test('an Endpoint and its Guard declaring one header with different annotations agree', () => {
    const endpoint = defineEndpoint({
      ...listing,
      guards: [userToken],
      input: { headers: z.object({ authorization: z.string().describe('A bearer token') }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('two Guards declaring one query param with different schemas fail', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      demands: { query: z.object({ tenant: z.uuid() }) },
    });
    const endpoint = defineEndpoint({ ...listing, guards: [userToken, tenant] });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query`,
        'input-conflict',
        'A query param has one schema across an Endpoint and its Guards: tenant differs between userToken and tenant',
      ),
    );
  });
});

describe('validateRoot: the values of a text part’s enum each have a text of their own', () => {
  function shared(noun: string, name: string, values: readonly [string, string]) {
    return `${noun}'s values each have a text of their own: ${name} has ${values[0]} and ${values[1]}`;
  }

  test('a query enum of 1 and "1" fails, naming both in the Snapshot’s order', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ v: z.literal([1, '1']) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.v`,
        'shared-text',
        shared('A query param', 'v', ['"1"', '1']),
      ),
    );
  });

  test('a header enum of true and "true" fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-dry': z.literal([true, 'true']) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-dry`,
        'shared-text',
        shared('A header', 'x-dry', ['"true"', 'true']),
      ),
    );
  });

  test('a path param enum of 1e21 and its plain decimal text fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.literal([1e21, '1000000000000000000000']) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        'endpoints.GET /orders/{} (listOrders) input.params.orderId',
        'shared-text',
        shared('A path param', 'orderId', ['"1000000000000000000000"', '1e+21']),
      ),
    );
  });

  test('a query list whose items are such an enum fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ v: z.array(z.literal([2, '2'])) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.v`,
        'shared-text',
        shared('A query param', 'v', ['"2"', '2']),
      ),
    );
  });

  test('a Rejection header with such an enum fails', () => {
    const rejection = aRejectionWith(headersOf({ 'x-realm': z.literal([1, '1']) }));

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(
        'codes.UNAUTHENTICATED headers.x-realm',
        'shared-text',
        shared('A header', 'x-realm', ['"1"', '1']),
      ),
    );
  });

  test('a Guard’s demanded header with such an enum fails', () => {
    const signed = defineGuard({
      name: 'signed',
      description: 'A signed request',
      demands: { headers: z.object({ 'x-version': z.literal([false, 'false']) }) },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [signed] }))).toEqual(
      failed(
        'guards.signed demands.headers.x-version',
        'shared-text',
        shared('A header', 'x-version', ['"false"', 'false']),
      ),
    );
  });

  test('an enum of 1 and "01" validates', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ v: z.literal([1, '01']) }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  /** The value a request's query `v=<text>` gives a query param `v` declared as an enum of these values. */
  function queryValueOf(values: readonly (string | number | boolean)[], text: string): unknown {
    const field = { required: true, schema: { type: 'enum', values, open: false } } as const;
    const nodes = { 'input.query': { type: 'object', fields: { v: field } } } as const;
    const source = { params: {}, query: new URLSearchParams({ v: text }), headers: new Headers() };
    return textPartsOf(nodes, source).query?.['v'];
  }

  test('generate accepts exactly the query enums each of whose values reads back as itself', () => {
    const next = seededNext(352);
    const pool = [
      0,
      1,
      -1,
      1.5,
      1e21,
      1e-7,
      true,
      false,
      '0',
      '1',
      '-1',
      '1.5',
      'true',
      'false',
      '01',
      '1000000000000000000000',
      '0.0000001',
    ];
    const draws = Array.from({ length: 200 }, () => {
      const size = 1 + Math.floor(next() * 4);
      const values = Array.from({ length: size }, () => pool[Math.floor(next() * pool.length)]);
      return [...new Set(values)] as [string | number | boolean, ...(string | number | boolean)[]];
    });

    for (const values of draws) {
      const endpoint = defineEndpoint({
        ...listing,
        input: { query: z.object({ v: z.literal(values) }) },
      });
      const readsBack = values.every((value) => queryValueOf(values, textOfValue(value)) === value);

      expect(validateEndpoint(endpoint).kind, JSON.stringify(values)).toBe(
        readsBack ? 'valid' : 'invalid',
      );
    }
  });
});

const ordersAt = 'endpoints.GET /orders/{} (listOrders)';

const words = {
  header: "A header's values each travel as HTTP field text",
  param: "A path param's values each travel as a URL segment",
  query: "A query param's values each travel as URL text",
} as const;

function unsendable(part: keyof typeof words, name: string, values: string) {
  return `${words[part]}: ${name} has ${values}`;
}

/** The text a part's field holds: the edge texts and their pairs, where each part's rule bites. */
const edgeTexts = [
  '',
  ' ',
  '\t',
  'a',
  'a b',
  'a\tb',
  'é',
  'ÿ',
  'Ā',
  '€',
  '\n',
  '\r',
  '\u007f',
  '.',
  '..',
  '\uD800',
  '😀',
];

/** Whether the runtime would refuse this text in the part, by the check it sends by. */
const runtimeRefuses = {
  headers: (value: string) => headerTextsOf('input.headers', { 'x-s': value }).kind === 'issues',
  params: (value: string) => !isSegmentText(value),
  query: (value: string) => !isQueryText(value),
} as const;

describe('validateRoot: the values of a text part’s enum each travel in their part', () => {
  test('an Input header literal of " 1" and "é\\n" fails, naming both', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.literal([' 1', 'é\n']) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '" 1" and "é\\n"'),
      ),
    );
  });

  test('a header enum of a value with a tab or space inside, visible ASCII, "é", "ÿ" and the empty text validates', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.literal(['a b', 'a\tb', 'v1, ~!', 'é', 'ÿ', '']) }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('a header value beyond U+00FF fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.enum(['€', 'a']) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '"€"'),
      ),
    );
  });

  test('a Success header literal holding a line feed fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      success: { ...listing.success, headers: z.object({ 'x-s': z.literal('a\n') }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} success.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '"a\\n"'),
      ),
    );
  });

  test('a Rejection header literal with a leading space fails', () => {
    const rejection = aRejectionWith(headersOf({ 'x-realm': z.literal(' x') }));

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(
        'codes.UNAUTHENTICATED headers.x-realm',
        'unsendable-text',
        unsendable('header', 'x-realm', '" x"'),
      ),
    );
  });

  test('a Guard’s demanded header literal that cannot travel fails', () => {
    const signed = defineGuard({
      name: 'signed',
      description: 'A signed request',
      demands: { headers: z.object({ 'x-version': z.literal('\n') }) },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [signed] }))).toEqual(
      failed(
        'guards.signed demands.headers.x-version',
        'unsendable-text',
        unsendable('header', 'x-version', '"\\n"'),
      ),
    );
  });

  test('an Open Enum header value that cannot travel fails as a closed one does', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': openEnum(['a\n', 'b']) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '"a\\n"'),
      ),
    );
  });

  test('a header enum of numbers and booleans validates', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.literal([0, -1.5, 1e21, true, false]) }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('a header string with a regex no field text matches validates, since its values are not closed', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.string().regex(/^\n$/) }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('a field with two values sharing a text and one that cannot travel fails with both rules’ lines', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.literal([1, '1', ' x']) }) },
    });

    const validated = validateEndpoint(endpoint);

    expect(validated).toMatchObject({
      failures: [
        { rule: 'shared-text', message: expect.stringContaining('x-s has ') },
        { rule: 'unsendable-text', message: unsendable('header', 'x-s', '" x"') },
      ],
    });
  });

  test('a path param literal of "", "." and ".." fails, naming all three', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:id',
      input: { params: z.object({ id: z.literal(['', '.', '..']) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${ordersAt} input.params.id`,
        'unsendable-text',
        unsendable('param', 'id', '"", "." and ".."'),
      ),
    );
  });

  test('a path param literal holding a lone surrogate fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:id',
      input: { params: z.object({ id: z.literal('\uD800') }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${ordersAt} input.params.id`,
        'unsendable-text',
        unsendable('param', 'id', '"\\ud800"'),
      ),
    );
  });

  test('a query literal holding a lone surrogate fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ q: z.literal('\uD800') }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.q`,
        'unsendable-text',
        unsendable('query', 'q', '"\\ud800"'),
      ),
    );
  });

  test('a query list whose item enum holds a lone surrogate fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ q: z.array(z.literal(['a', '\uD800'])) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.q`,
        'unsendable-text',
        unsendable('query', 'q', '"\\ud800"'),
      ),
    );
  });

  test('a path param literal of "a/b", "%" and "é" validates, since each is percent-encoded', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:id',
      input: { params: z.object({ id: z.literal(['a/b', '%', 'é']) }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  function endpointHolding(part: keyof typeof runtimeRefuses, values: [string, ...string[]]) {
    const enumeration = z.literal(values);
    switch (part) {
      case 'headers':
        return defineEndpoint({ ...listing, input: { headers: z.object({ 'x-s': enumeration }) } });
      case 'query':
        return defineEndpoint({ ...listing, input: { query: z.object({ 'x-s': enumeration }) } });
      case 'params':
        return defineEndpoint({
          ...listing,
          path: '/orders/:xS',
          input: { params: z.object({ xS: enumeration }) },
        });
    }
  }

  test('generate refuses a text part’s enum exactly when one of its values fails the part’s runtime check', () => {
    const next = seededNext(455);
    const edge = () => edgeTexts[Math.floor(next() * edgeTexts.length)] as string;
    const drawn = Array.from({ length: 150 }, () => {
      const size = 1 + Math.floor(next() * 3);
      const values = Array.from({ length: size }, () => `${edge()}${edge()}`);
      return [...new Set(values)] as [string, ...string[]];
    });

    for (const values of drawn) {
      for (const part of ['headers', 'params', 'query'] as const) {
        const validated = validateEndpoint(endpointHolding(part, values));
        const rules =
          validated.kind === 'valid' ? [] : validated.failures.map((failure) => failure.rule);

        expect(rules, `${part} ${JSON.stringify(values)}`).toEqual(
          values.some(runtimeRefuses[part]) ? ['unsendable-text'] : [],
        );
      }
    }
  });
});

describe('validateRoot: a text part’s examples each travel in their part', () => {
  test('a header string whose example is " a" fails at that header, naming it', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.string().meta({ examples: [' a'] }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '" a"'),
      ),
    );
  });

  test('a header’s examples "€" and "a\\n" fail in one line naming both', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.string().meta({ examples: ['€', 'a\n'] }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '"€" and "a\\n"'),
      ),
    );
  });

  test('a header’s examples of visible ASCII, a tab inside, "é", "ÿ" and the empty text validate', () => {
    const examples = ['v1, ~!', 'a\tb', 'é', 'ÿ', ''];
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.string().meta({ examples }) }) },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('a Success header example that cannot travel fails at that header', () => {
    const endpoint = defineEndpoint({
      ...listing,
      success: {
        ...listing.success,
        headers: z.object({ 'x-s': z.string().meta({ examples: [' a'] }) }),
      },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} success.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '" a"'),
      ),
    );
  });

  test('a Rejection header example that cannot travel fails at that header', () => {
    const rejection = aRejectionWith(
      headersOf({ 'x-realm': z.string().meta({ examples: ['\n'] }) }),
    );

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(
        'codes.UNAUTHENTICATED headers.x-realm',
        'unsendable-text',
        unsendable('header', 'x-realm', '"\\n"'),
      ),
    );
  });

  test('a Guard’s demanded header example that cannot travel fails at that header', () => {
    const signed = defineGuard({
      name: 'signed',
      description: 'A signed request',
      demands: { headers: z.object({ 'x-version': z.string().meta({ examples: [' 1'] }) }) },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [signed] }))).toEqual(
      failed(
        'guards.signed demands.headers.x-version',
        'unsendable-text',
        unsendable('header', 'x-version', '" 1"'),
      ),
    );
  });

  test('a path param’s examples "", "." and ".." fail, naming all three', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:id',
      input: { params: z.object({ id: z.string().meta({ examples: ['', '.', '..'] }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${ordersAt} input.params.id`,
        'unsendable-text',
        unsendable('param', 'id', '"", "." and ".."'),
      ),
    );
  });

  test('a query param’s example holding a lone surrogate fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ q: z.string().meta({ examples: ['\uD800'] }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.q`,
        'unsendable-text',
        unsendable('query', 'q', '"\\ud800"'),
      ),
    );
  });

  test('an optional header’s example that cannot travel fails as a required one’s does', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: {
        headers: z.object({
          'x-s': z
            .string()
            .optional()
            .meta({ examples: [' a'] }),
        }),
      },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '" a"'),
      ),
    );
  });

  test('a query list’s own example holding a lone surrogate fails', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ q: z.array(z.string()).meta({ examples: [['a', '\uD800']] }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.q`,
        'unsendable-text',
        unsendable('query', 'q', '"\\ud800"'),
      ),
    );
  });

  test('a query list’s own example and its items’ example holding a lone surrogate name it once', () => {
    const items = z.string().meta({ examples: ['\uD800'] });
    const endpoint = defineEndpoint({
      ...listing,
      input: { query: z.object({ q: z.array(items).meta({ examples: [['\uD800']] }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.query.q`,
        'unsendable-text',
        unsendable('query', 'q', '"\\ud800"'),
      ),
    );
  });

  test('a headers object whose own example gives a field " a" fails at that field', () => {
    const headers = z
      .object({ 'x-s': z.string(), 'x-t': z.string() })
      .meta({ examples: [{ 'x-s': 'a', 'x-t': ' a' }] });
    const endpoint = defineEndpoint({ ...listing, input: { headers } });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-t`,
        'unsendable-text',
        unsendable('header', 'x-t', '" a"'),
      ),
    );
  });

  test('a headers object example that leaves an optional field out validates', () => {
    const headers = z
      .object({ 'x-s': z.string(), 'x-o': z.string().optional() })
      .meta({ examples: [{ 'x-s': 'a' }] });
    const endpoint = defineEndpoint({ ...listing, input: { headers } });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('a Success headers object whose own example gives a field " a" fails at that field', () => {
    const headers = z.object({ 'x-s': z.string() }).meta({ examples: [{ 'x-s': ' a' }] });
    const endpoint = defineEndpoint({ ...listing, success: { ...listing.success, headers } });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} success.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '" a"'),
      ),
    );
  });

  test('a Rejection headers object whose own example gives a field a line feed fails at that field', () => {
    const headers = headersOf({ 'x-realm': z.string() }).meta({ examples: [{ 'x-realm': '\n' }] });
    const rejection = aRejectionWith(headers);

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(
        'codes.UNAUTHENTICATED headers.x-realm',
        'unsendable-text',
        unsendable('header', 'x-realm', '"\\n"'),
      ),
    );
  });

  test('a Guard’s demanded headers object whose own example gives a field " 1" fails at that field', () => {
    const headers = z
      .object({ 'x-version': z.string() })
      .meta({ examples: [{ 'x-version': ' 1' }] });
    const signed = defineGuard({
      name: 'signed',
      description: 'A signed request',
      demands: { headers },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [signed] }))).toEqual(
      failed(
        'guards.signed demands.headers.x-version',
        'unsendable-text',
        unsendable('header', 'x-version', '" 1"'),
      ),
    );
  });

  test('a Guard’s demanded query object whose own example gives a field a lone surrogate fails at that field', () => {
    const query = z.object({ q: z.string() }).meta({ examples: [{ q: '\uD800' }] });
    const signed = defineGuard({
      name: 'signed',
      description: 'A signed request',
      demands: { query },
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [signed] }))).toEqual(
      failed(
        'guards.signed demands.query.q',
        'unsendable-text',
        unsendable('query', 'q', '"\\ud800"'),
      ),
    );
  });

  test('a number or a boolean header’s examples validate, since each is always carried', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: {
        headers: z.object({
          'x-n': z.number().meta({ examples: [0, -1.5, 1e21] }),
          'x-b': z.boolean().meta({ examples: [true, false] }),
        }),
      },
    });

    expect(validateEndpoint(endpoint).kind).toBe('valid');
  });

  test('an enum value that cannot travel and the same value as its example are named once', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: { headers: z.object({ 'x-s': z.enum([' x', 'a']).meta({ examples: [' x'] }) }) },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', '" x"'),
      ),
    );
  });

  /** Where an example of a text field sits: the field, the part's own examples, a query list or its items. */
  const placements = {
    headers: ['field', 'part'],
    params: ['field', 'part'],
    query: ['field', 'part', 'partList', 'list', 'items'],
  } as const;

  type Part = keyof typeof placements;
  type Placement = (typeof placements)[Part][number];

  const fieldNames = {
    headers: { text: 'x-s', number: 'x-n', boolean: 'x-b' },
    query: { text: 'x-s', number: 'x-n', boolean: 'x-b' },
    params: { text: 'xS', number: 'xN', boolean: 'xB' },
  } as const;

  /** The schema of the text field, with `values` as examples where `placement` puts them. */
  function textFieldOf(placement: Placement, values: string[]): z.ZodType {
    switch (placement) {
      case 'field':
        return z.string().meta({ examples: values });
      case 'list':
        return z.array(z.string()).meta({ examples: [values] });
      case 'items':
        return z.array(z.string().meta({ examples: values }));
      case 'part':
        return z.string();
      case 'partList':
        return z.array(z.string());
    }
  }

  /** The part's examples when `placement` puts the values there: each leaves an optional field out. */
  function partExamplesOf(placement: Placement, values: string[], part: Part) {
    const { text, number, boolean } = fieldNames[part];
    const others = { [number]: 2, [boolean]: false };
    if (placement === 'partList') {
      return [{ [text]: values, ...others }];
    }
    return placement === 'part' ? values.map((value) => ({ [text]: value, ...others })) : [];
  }

  /** An Endpoint whose text field holds `values` as examples at `placement` of `part`, beside an optional field and a number and a boolean field with examples of their own. */
  function endpointWithExamples(part: Part, placement: Placement, values: string[]) {
    const { text, number, boolean } = fieldNames[part];
    const optional = part === 'params' ? {} : { 'x-o': z.string().optional() };
    const shape = {
      [text]: textFieldOf(placement, values),
      [number]: z.number().meta({ examples: [0, 1.5] }),
      [boolean]: z.boolean().meta({ examples: [true] }),
      ...optional,
    };
    const examples = partExamplesOf(placement, values, part);
    const object = headersOf(shape).meta(examples.length === 0 ? {} : { examples });
    const path = part === 'params' ? '/orders/:xS/:xN/:xB' : '/orders';
    return defineEndpoint({ ...listing, path, input: { [part]: object } } as never);
  }

  /** The rules `generate` breaks on an Endpoint whose text field holds `values` as examples. */
  function rulesOf(part: Part, placement: Placement, values: string[]) {
    const validated = validateEndpoint(endpointWithExamples(part, placement, values));
    return validated.kind === 'valid' ? [] : validated.failures.map((failure) => failure.rule);
  }

  const sites = Object.entries(placements).flatMap(([part, held]) =>
    held.map((placement) => ({ part: part as Part, placement })),
  );

  test('generate refuses a text field exactly when one of its examples fails the part’s runtime check', () => {
    const next = seededNext(463);
    const edge = () => edgeTexts[Math.floor(next() * edgeTexts.length)] as string;
    const outcomes = sites.map(() => new Set<string>());

    for (let draw = 0; draw < 200; draw++) {
      const size = 1 + Math.floor(next() * 3);
      const values = [...new Set(Array.from({ length: size }, () => `${edge()}${edge()}`))];
      for (const [at, { part, placement }] of sites.entries()) {
        const refused = values.some(runtimeRefuses[part]);

        expect(
          rulesOf(part, placement, values),
          `${part} ${placement} ${JSON.stringify(values)}`,
        ).toEqual(refused ? ['unsendable-text'] : []);
        outcomes[at]?.add(refused ? 'refused' : 'valid');
      }
    }

    expect(outcomes.map((seen) => [...seen].sort())).toEqual(sites.map(() => ['refused', 'valid']));
  });
});

describe('validateRoot: the time it takes to judge the examples of a text part', () => {
  /** A header object, as the validated Root of an Endpoint taking it, for `orderOf` to time. */
  function judgingHeaders(headers: z.ZodObject) {
    const root = rootOf(defineEndpoint({ ...listing, input: { headers } }));
    return () => validateRoot(root, aRootPackage(root));
  }

  test('a header with 8,000 refused examples is one line naming each, in time that grows as they do', () => {
    const examplesOf = (count: number) => Array.from({ length: count }, (_, at) => ` e${at}`);
    const told = (size: number) =>
      judgingHeaders(z.object({ 'x-s': z.string().meta({ examples: examplesOf(size) }) }));

    const order = orderOf(told, { small: 1000, large: 8000 }, orders.linear);
    const named = examplesOf(8000).map((example) => JSON.stringify(example));
    const values = `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;

    expect(summarized(told(8000)())).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', values),
      ),
    );
    expect(order).toBeLessThan(orders.linear);
  });

  test('800 optional headers each given a value by 20 examples of their object validate, in time that grows as they do', () => {
    const headersOfWidth = (width: number) => {
      const names = Array.from({ length: width }, (_, at) => `x-f${at}`);
      const shape = Object.fromEntries(names.map((name) => [name, z.string().optional()]));
      const examples = Array.from({ length: 20 }, (_, at) =>
        Object.fromEntries(names.map((name) => [name, `v${at}`])),
      );
      return z.object(shape).meta({ examples });
    };
    const told = (size: number) => judgingHeaders(headersOfWidth(size));

    const order = orderOf(told, { small: 100, large: 800 }, orders.linear);

    expect(summarized(told(800)()).kind).toBe('valid');
    expect(order).toBeLessThan(orders.linear);
  });

  test('a header example refused for its trailing space is one line, in time that grows as its length does', () => {
    const exampleOf = (length: number) => `${'a'.repeat(length)} `;
    const told = (size: number) =>
      judgingHeaders(z.object({ 'x-s': z.string().meta({ examples: [exampleOf(size)] }) }));

    const order = orderOf(told, { small: 2_500, large: 20_000 }, orders.linear);

    expect(summarized(told(20_000)())).toEqual(
      failed(
        `${endpointAt} input.headers.x-s`,
        'unsendable-text',
        unsendable('header', 'x-s', JSON.stringify(exampleOf(20_000))),
      ),
    );
    expect(order).toBeLessThan(orders.linear);
  });
});
