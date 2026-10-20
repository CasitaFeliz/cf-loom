import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Endpoint,
} from '../index.ts';
import { walkedTextPartsOf } from '../internal/index.ts';

const userToken = defineGuard({
  name: 'userToken',
  description: 'A user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
});

/** A Contract of the given Endpoints, in one Group. */
function contractOf(...endpoints: readonly [Endpoint, ...Endpoint[]]) {
  return defineContract({
    name: 'orders-service',
    groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints })],
  });
}

describe('walkedTextPartsOf', () => {
  test('walks the parts of an Endpoint that travel as text, each an object of its fields', () => {
    const getOrder = defineEndpoint({
      name: 'getOrder',
      method: 'GET',
      path: '/orders/:orderId',
      visibility: 'public',
      description: 'One order',
      input: {
        params: z.object({ orderId: z.string() }),
        query: z.object({ ids: z.array(z.number()).optional() }),
      },
      success: { status: 204 },
    });

    const walked = walkedTextPartsOf(contractOf(getOrder));

    const nodes = walked.kind === 'valid' ? walked.nodes.get(getOrder) : undefined;
    expect(nodes?.['input.query']).toEqual({
      type: 'object',
      mode: 'open',
      fields: { ids: { required: false, schema: { type: 'array', items: { type: 'number' } } } },
    });
    expect(nodes?.['input.headers']).toBeUndefined();
  });

  test('walks what a Guard demands, once for every Endpoint that attaches it', () => {
    const anEndpoint = (name: string, path: string) =>
      defineEndpoint({
        name,
        method: 'GET',
        path,
        visibility: 'public',
        description: 'An Endpoint',
        guards: [userToken],
        success: { status: 204 },
      });

    const walked = walkedTextPartsOf(contractOf(anEndpoint('a', '/a'), anEndpoint('b', '/b')));

    const nodes = walked.kind === 'valid' ? walked.nodes.get(userToken) : undefined;
    expect(nodes?.['demands.headers']?.fields).toHaveProperty('authorization');
  });

  test('a text part generate refuses is a failure, as generate words it', () => {
    const search = defineEndpoint({
      name: 'search',
      method: 'GET',
      path: '/search',
      visibility: 'public',
      description: 'Searches',
      input: { query: z.object({ filter: z.object({ name: z.string() }) }) },
      success: { status: 204 },
    });

    const walked = walkedTextPartsOf(contractOf(search));

    expect(walked).toMatchObject({
      kind: 'invalid',
      failures: [{ rule: 'not-text', message: expect.stringContaining('filter') }],
    });
  });

  test('a query that is a record keyed by an enum is a failure, as generate words it', () => {
    const filtered = defineEndpoint({
      name: 'filtered',
      method: 'GET',
      path: '/filtered',
      visibility: 'public',
      description: 'Filters',
      input: { query: z.record(z.enum(['a', 'b']), z.string()) as never },
      success: { status: 204 },
    });

    const walked = walkedTextPartsOf(contractOf(filtered));

    expect(walked).toMatchObject({
      kind: 'invalid',
      failures: [
        {
          kind: 'not-allowed',
          at: ['groups', 'orders', 'endpoints', 'GET /filtered', 'input', 'query'],
        },
      ],
    });
  });

  test('a text part that is no object is a failure', () => {
    const lookup = defineEndpoint({
      name: 'lookup',
      method: 'GET',
      path: '/lookup',
      visibility: 'public',
      description: 'Looks up',
      input: { headers: z.string() as never },
      success: { status: 204 },
    });

    const walked = walkedTextPartsOf(contractOf(lookup));

    expect(walked).toMatchObject({ kind: 'invalid', failures: [{ rule: 'not-an-object-schema' }] });
  });
});
