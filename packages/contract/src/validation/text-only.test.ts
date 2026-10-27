import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { summarized } from '../../test/failures.ts';
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
import { type Root, validateRoot } from '../internal/index.ts';

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

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(defineService({ name: 'orders-service', groups: [orders] }));
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
