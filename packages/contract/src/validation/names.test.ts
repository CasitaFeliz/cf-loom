import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  type Group,
} from '../index.ts';
import { validateContract } from '../internal/index.ts';

function noOrigin() {
  return undefined;
}

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

const creating = {
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Creates an order',
  success: { status: 201, body: z.object({ id: z.uuid() }) },
} as const;

const listOrders = defineEndpoint(listing);
const createOrder = defineEndpoint(creating);

function aGroup(name: string, endpoints: readonly [Endpoint, ...Endpoint[]]): Group {
  return defineGroup({ name, description: 'Orders', endpoints });
}

function validateGroups(groups: readonly Group[]) {
  return validateContract(defineContract({ name: 'orders-service', groups }), noOrigin);
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: name grammars', () => {
  test('a kebab-case Service name validates', () => {
    const contract = defineContract({
      name: 'orders-service-2',
      groups: [aGroup('orders', [listOrders])],
    });

    expect(validateContract(contract, noOrigin).kind).toBe('valid');
  });

  test('a Service name that is not kebab-case fails', () => {
    const contract = defineContract({
      name: 'OrdersService',
      groups: [aGroup('orders', [listOrders])],
    });

    expect(validateContract(contract, noOrigin)).toEqual(
      failed(['name'], 'name-grammar', 'A Service name is kebab-case: OrdersService'),
    );
  });

  test('a Group name that is not kebab-case fails', () => {
    expect(validateGroups([aGroup('Orders', [listOrders])])).toEqual(
      failed(['groups', 'Orders', 'name'], 'name-grammar', 'A Group name is kebab-case: Orders'),
    );
  });

  test('an Endpoint name that is not camelCase fails', () => {
    const endpoint = defineEndpoint({ ...listing, name: 'list_orders' });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'name'],
        'name-grammar',
        'An Endpoint name is camelCase: list_orders',
      ),
    );
  });

  test('a Guard name that is not camelCase fails', () => {
    const apiKey = defineGuard({ name: 'ApiKey', description: 'A key' });
    const endpoint = defineEndpoint({ ...listing, guards: [apiKey] });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(['guards', 'ApiKey', 'name'], 'name-grammar', 'A Guard name is camelCase: ApiKey'),
    );
  });

  test('a Rejection code that is not UPPER_SNAKE_CASE fails', () => {
    const locked = defineRejection({ code: 'orderLocked', status: 409, message: 'Locked' });
    const endpoint = defineEndpoint({ ...listing, rejections: [locked] });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        ['rejections', 'orderLocked', 'code'],
        'name-grammar',
        'A Rejection code is UPPER_SNAKE_CASE: orderLocked',
      ),
    );
  });

  test('a Definitions Package name that is not kebab-case fails', () => {
    const definitions = defineDefinitions({ name: 'Definitions' });

    expect(validateContract(definitions, noOrigin)).toEqual(
      failed(['name'], 'name-grammar', 'A Definitions Package name is kebab-case: Definitions'),
    );
  });

  test('a Standard Rejection code a Definitions Package declares follows the code grammar', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'not-found', status: 404, message: 'Not found' } },
    });

    expect(validateContract(definitions, noOrigin)).toEqual(
      failed(
        ['standardRejections', 'notFound', 'code'],
        'name-grammar',
        'A Rejection code is UPPER_SNAKE_CASE: not-found',
      ),
    );
  });
});

describe('validateContract: unique names and identities', () => {
  test('two Endpoints with the same name fail', () => {
    const listAgain = defineEndpoint({ ...listing, path: '/orders/latest' });

    expect(validateGroups([aGroup('orders', [listOrders, listAgain])])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders/latest', 'name'],
        'duplicate-endpoint-name',
        'An Endpoint name is unique among the Endpoints that are not Retired: listOrders',
      ),
    );
  });

  test('a Retired Endpoint may share its name with an Active one', () => {
    const retired = defineEndpoint({ ...listing, path: '/orders/all', lifecycle: 'retired' });

    expect(validateGroups([aGroup('orders', [retired, listOrders])]).kind).toBe('valid');
  });

  test('two Endpoints with the same method and path fail', () => {
    const getLatest = defineEndpoint({
      ...listing,
      name: 'getLatestOrder',
      path: '/orders/:id',
      input: { params: z.object({ id: z.uuid() }) },
    });
    const getOrder = defineEndpoint({
      ...listing,
      name: 'getOrder',
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid() }) },
    });

    expect(validateGroups([aGroup('orders', [getLatest, getOrder])])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'path'],
        'duplicate-endpoint-identity',
        'An Endpoint is identified by its method and path, once: GET /orders/{}',
      ),
    );
  });

  test('the same path under two methods validates', () => {
    expect(validateGroups([aGroup('orders', [listOrders, createOrder])]).kind).toBe('valid');
  });

  test('two Guards with the same name fail', () => {
    const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
    const anotherApiKey = defineGuard({ name: 'apiKey', description: 'Another key' });
    const first = defineEndpoint({ ...listing, guards: [apiKey] });
    const second = defineEndpoint({ ...creating, guards: [anotherApiKey] });

    expect(validateGroups([aGroup('orders', [first, second])])).toEqual(
      failed(
        ['guards', 'apiKey', 'name'],
        'duplicate-guard-name',
        'A Guard name is unique across the Contract and its Definitions Packages: apiKey',
      ),
    );
  });

  test('a Guard named like one in a listed Definitions Package fails', () => {
    const shared = defineGuard({ name: 'apiKey', description: 'A key' });
    const local = defineGuard({ name: 'apiKey', description: 'A local key' });
    const definitions = defineDefinitions({ name: 'definitions', guards: [shared] });
    const endpoint = defineEndpoint({ ...listing, guards: [local] });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [aGroup('orders', [endpoint])],
    });

    expect(validateContract(contract, noOrigin)).toEqual(
      failed(
        ['guards', 'apiKey', 'name'],
        'duplicate-guard-name',
        'A Guard name is unique across the Contract and its Definitions Packages: apiKey',
      ),
    );
  });

  test('the same Guard attached by two Endpoints is one Guard', () => {
    const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
    const first = defineEndpoint({ ...listing, guards: [apiKey] });
    const second = defineEndpoint({ ...creating, guards: [apiKey] });

    expect(validateGroups([aGroup('orders', [first, second])]).kind).toBe('valid');
  });
});

describe('validateContract: Groups', () => {
  test('an Endpoint listed in two Groups fails', () => {
    expect(validateGroups([aGroup('orders', [listOrders]), aGroup('sales', [listOrders])])).toEqual(
      failed(
        ['groups', 'sales', 'endpoints', 'GET /orders'],
        'group-membership',
        'An Endpoint belongs to exactly one Group: listOrders is also in orders',
      ),
    );
  });

  test('an Endpoint listed twice in one Group fails', () => {
    expect(validateGroups([aGroup('orders', [listOrders, listOrders])])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders'],
        'group-membership',
        'An Endpoint belongs to exactly one Group: listOrders is also in orders',
      ),
    );
  });

  test('two Groups with one name fail', () => {
    expect(
      validateGroups([aGroup('orders', [listOrders]), aGroup('orders', [createOrder])]),
    ).toEqual(
      failed(
        ['groups', 'orders', 'name'],
        'duplicate-group-name',
        'A Group name is unique in the Contract: orders',
      ),
    );
  });

  test('an empty Group fails', () => {
    const endpoints = [] as unknown as readonly [Endpoint];

    expect(validateGroups([aGroup('orders', endpoints)])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints'],
        'empty-group',
        'A Group lists at least one Endpoint',
      ),
    );
  });
});
