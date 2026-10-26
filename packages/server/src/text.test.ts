import { defineEndpoint, defineGroup, defineGuard, defineService } from '@cf-loom/contract';
import { admit, handle, success } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { serve } from './index.ts';

const tenant = defineGuard({
  name: 'tenant',
  description: 'The tenant a request is for',
  demands: { query: z.object({ tenant: z.string() }) },
});

const echoed = z.object({ received: z.json() });

const getPage = defineEndpoint({
  name: 'getPage',
  method: 'GET',
  path: '/pages/:page/:draft',
  visibility: 'public',
  description: 'One page',
  input: { params: z.object({ page: z.number(), draft: z.boolean() }) },
  success: { status: 200, body: echoed },
});

const search = defineEndpoint({
  name: 'search',
  method: 'GET',
  path: '/search',
  visibility: 'public',
  description: 'Searches',
  guards: [tenant],
  input: {
    query: z.object({
      ids: z.array(z.number()).optional(),
      term: z.string().optional(),
      size: z.literal(5).optional(),
      sort: z.enum(['asc', 'desc']).optional(),
    }),
    headers: z.object({ 'x-limit': z.number().optional(), 'x-trace': z.string().optional() }),
  },
  success: { status: 200, body: echoed },
});

const lookup = defineEndpoint({
  name: 'lookup',
  method: 'GET',
  path: '/lookup',
  visibility: 'public',
  description: 'Looks one up',
  input: { headers: z.object({ 'x-key': z.string() }) },
  success: { status: 200, body: echoed },
});

const contract = defineService({
  name: 'pages-service',
  groups: [
    defineGroup({ name: 'pages', description: 'Pages', endpoints: [getPage, search, lookup] }),
  ],
});

const http = serve(contract, {
  endpoints: {
    getPage: handle(getPage, (input) => success({ received: input as never })),
    search: handle(search, (input) => success({ received: input as never })),
    lookup: handle(lookup, (input) => success({ received: input as never })),
  },
  guards: { tenant: handle(tenant, () => admit()) },
  deprecatedAt: {},
});

/** What every Handler here answers: the Input it received, part by part. */
type Echo = { readonly received: Readonly<Record<string, Readonly<Record<string, unknown>>>> };

async function answerOf(path: string, headers?: Headers | Record<string, string>) {
  const response = await http(new Request(`http://test${path}`, headers ? { headers } : {}));
  return { status: response.status, body: (await response.json()) as Echo };
}

function issuesOf(answer: { readonly body: unknown }): unknown {
  return (answer.body as { rejection: { body: { issues: unknown } } }).rejection.body.issues;
}

describe('serve: path params, query params and headers as text', () => {
  test('a number and a boolean param are converted to their types', async () => {
    const answer = await answerOf('/pages/-1.5/true');

    expect(answer.body).toEqual({ received: { params: { page: -1.5, draft: true } } });
  });

  test('a number that breaks the pattern is invalid_type', async () => {
    const answers = await Promise.all(
      ['/pages/01/true', '/pages/1./true', '/pages/abc/true'].map((path) => answerOf(path)),
    );

    expect(answers.map(issuesOf)).toEqual(
      Array(3).fill([
        { in: 'params', path: ['page'], code: 'invalid_type', message: expect.any(String) },
      ]),
    );
  });

  test('a boolean is exactly true or false', async () => {
    const answer = await answerOf('/pages/1/True');

    expect(issuesOf(answer)).toEqual([
      { in: 'params', path: ['draft'], code: 'invalid_type', message: expect.any(String) },
    ]);
  });

  test('a list query param is a repeated key, and one occurrence is a one-item list', async () => {
    const answers = [
      await answerOf('/search?tenant=t&ids=1&ids=2'),
      await answerOf('/search?tenant=t&ids=7'),
    ];

    expect(answers.map(({ body }) => body.received['query']?.['ids'])).toEqual([[1, 2], [7]]);
  });

  test('a repeated single-value query key is invalid input', async () => {
    const answer = await answerOf('/search?tenant=t&term=a&term=b');

    expect(issuesOf(answer)).toEqual([
      { in: 'query', path: ['term'], code: 'invalid_type', message: expect.any(String) },
    ]);
  });

  test('a + in a query string is a space', async () => {
    const answer = await answerOf('/search?tenant=t&term=red+shoes');

    expect(answer.body.received['query']?.['term']).toBe('red shoes');
  });

  test('a literal or an enum field takes its declared value, a numeric literal included', async () => {
    const answer = await answerOf('/search?tenant=t&size=5&sort=desc');

    expect(answer.body.received['query']).toEqual({ size: 5, sort: 'desc' });
  });

  test('a header is converted to its declared type', async () => {
    const answer = await answerOf('/search?tenant=t', { 'x-limit': '20' });

    expect(answer.body.received['headers']).toEqual({ 'x-limit': 20 });
  });

  test('a missing required header is required at headers', async () => {
    const answer = await answerOf('/lookup');

    expect(issuesOf(answer)).toEqual([
      { in: 'headers', path: ['x-key'], code: 'required', message: expect.any(String) },
    ]);
  });

  test('a header given several times arrives as one comma-joined text', async () => {
    const headers = new Headers([
      ['x-key', 'a'],
      ['x-key', 'b'],
    ]);

    const answer = await answerOf('/lookup', headers);

    expect(answer.body.received['headers']).toEqual({ 'x-key': 'a, b' });
  });

  test('an undeclared query param or header is ignored', async () => {
    const answer = await answerOf('/search?tenant=t&other=1', { 'x-other': 'x' });

    expect(answer).toEqual({ status: 200, body: { received: { query: {}, headers: {} } } });
  });

  test('the EndpointHandler receives only its own query params, not a Guard’s demanded one', async () => {
    const answer = await answerOf('/search?tenant=t&term=a');

    expect(answer.body.received['query']).toEqual({ term: 'a' });
  });
});
