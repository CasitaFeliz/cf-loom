import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Endpoint,
} from '../index.ts';
import {
  attachmentsOf,
  endpointsOf,
  isInputPart,
  pathSegmentsOf,
  walkedTextPartsOf,
} from '../internal/index.ts';

const userToken = defineGuard({
  name: 'userToken',
  description: 'A user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(z.string()),
});

function anEndpoint<const Name extends string>(name: Name, path: string) {
  return defineEndpoint({
    name,
    method: 'GET',
    path,
    visibility: 'public',
    description: 'An Endpoint',
    success: { status: 204 },
  });
}

describe('endpointsOf', () => {
  test('lists each Endpoint once, in Group order', () => {
    const listOrders = anEndpoint('listOrders', '/orders');
    const getOrder = anEndpoint('getOrder', '/orders/a');
    const ping = anEndpoint('ping', '/ping');
    const contract = defineContract({
      name: 'orders-service',
      groups: [
        defineGroup({ name: 'orders', description: 'Orders', endpoints: [listOrders, getOrder] }),
        defineGroup({ name: 'health', description: 'Health', endpoints: [ping, listOrders] }),
      ],
    });

    const endpoints = endpointsOf(contract);

    expect(endpoints).toEqual([listOrders, getOrder, ping]);
  });
});

describe('attachmentsOf', () => {
  test('gives each Guard with its Qualifier, undefined when bare', () => {
    const updateOrder = defineEndpoint({
      name: 'updateOrder',
      method: 'PUT',
      path: '/orders',
      visibility: 'public',
      description: 'Changes an order',
      guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
      success: { status: 204 },
    });

    const attachments = attachmentsOf(updateOrder);

    expect(attachments).toEqual([
      { guard: userToken, qualifier: undefined },
      { guard: permission, qualifier: ['orders:edit'] },
    ]);
  });
});

describe('pathSegmentsOf', () => {
  test('tells literals from params, and the root has none', () => {
    const segments = pathSegmentsOf('/orders/:orderId/lines');

    expect(segments).toEqual([
      { kind: 'literal', text: 'orders' },
      { kind: 'param', name: 'orderId' },
      { kind: 'literal', text: 'lines' },
    ]);
    expect(pathSegmentsOf('/')).toEqual([]);
  });
});

describe('isInputPart', () => {
  test('admits the Input and demand parts only', () => {
    const parts = [
      'input.params',
      'input.query',
      'input.headers',
      'input.body',
      'demands.headers',
      'demands.query',
      'context',
      'qualifier',
      'success.body',
      'rejections',
    ] as const;

    const admitted = parts.filter(isInputPart);

    expect(admitted).toEqual([
      'input.params',
      'input.query',
      'input.headers',
      'input.body',
      'demands.headers',
      'demands.query',
    ]);
  });
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
