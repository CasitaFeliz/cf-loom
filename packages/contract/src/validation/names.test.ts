import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineApplication,
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  type Group,
} from '../index.ts';
import { type RootPackage, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const packageName = typeof name === 'string' ? name : '';
  return validateContract(root, { originOf, packageName, exportsOf: () => [] });
}

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
  return validateInPackage(defineContract({ name: 'orders-service', groups }), noOrigin);
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

    expect(validateInPackage(contract, noOrigin).kind).toBe('valid');
  });

  test('a Service name that is not kebab-case fails', () => {
    const contract = defineContract({
      name: 'OrdersService',
      groups: [aGroup('orders', [listOrders])],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual(
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
        'An Endpoint name is camelCase words: list_orders',
      ),
    );
  });

  test('a Guard name that is not camelCase fails', () => {
    const apiKey = defineGuard({ name: 'ApiKey', description: 'A key' });
    const endpoint = defineEndpoint({ ...listing, guards: [apiKey] });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        ['guards', 'ApiKey', 'name'],
        'name-grammar',
        'A Guard name is camelCase words: ApiKey',
      ),
    );
  });

  test.each([
    ['getURL', 'getUrl'],
    ['getURLs', 'getUrLs'],
    ['URLs', undefined],
    ['listIDs', undefined],
    ['getX', undefined],
    ['settle2X', undefined],
  ])('an Endpoint named %s, with a capital that starts no word, fails', (name, written) => {
    const endpoint = defineEndpoint({ ...listing, name });
    const hint = written === undefined ? '' : ` (write ${written})`;

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'name'],
        'name-grammar',
        `An Endpoint name is camelCase words: ${name}${hint}`,
      ),
    );
  });

  test('a Guard named useAPI, whose last capital starts no word, fails with the name to write', () => {
    const apiKey = defineGuard({ name: 'useAPI', description: 'A key' });
    const endpoint = defineEndpoint({ ...listing, guards: [apiKey] });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        ['guards', 'useAPI', 'name'],
        'name-grammar',
        'A Guard name is camelCase words: useAPI (write useApi)',
      ),
    );
  });

  test.each(['getUrl', 'getOrderById', 'createOrderV2', 'settle2', 'settle2Xy', 'a'])(
    'an Endpoint named %s, whose every capital starts a word, validates',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
    },
  );

  test('a path param written :orderID, which is never re-spelled, validates', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:orderID',
      // biome-ignore lint/style/useNamingConvention: the param under test ends in a capital
      input: { params: z.object({ orderID: z.string() }) },
    });

    expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
  });

  test('a recursion id written nodeID, which is never re-spelled, validates', () => {
    const node = z
      .object({
        value: z.string(),
        get children() {
          return z.array(node);
        },
      })
      .meta({ id: 'nodeID' });
    const endpoint = defineEndpoint({ ...listing, success: { status: 200, body: node } });

    expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
  });

  test.each(['delete', 'yield', 'await', 'eval', 'default', 'handle'])(
    'an Endpoint named %s, a word code cannot name it by, fails',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
        failed(
          ['groups', 'orders', 'endpoints', 'GET /orders', 'name'],
          'name-grammar',
          `An Endpoint name is camelCase words and no reserved word: ${name}`,
        ),
      );
    },
  );

  test.each([
    'then',
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf',
  ])('an Endpoint named %s, a name every object has or JavaScript calls, fails', (name) => {
    const endpoint = defineEndpoint({ ...listing, name });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'name'],
        'name-grammar',
        `An Endpoint name is camelCase words and no reserved word: ${name}`,
      ),
    );
  });

  test('an Endpoint named toJSON, which breaks the words and is a name JavaScript calls, reads both', () => {
    // @ts-expect-error a literal reserved name is a type error
    const endpoint = defineEndpoint({ ...listing, name: 'toJSON' });

    expect(validateGroups([aGroup('orders', [endpoint])])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'name'],
        'name-grammar',
        'An Endpoint name is camelCase words and no reserved word: toJSON (write toJson)',
      ),
    );
  });

  test.each([...Object.getOwnPropertyNames(Object.prototype), 'then', 'toJSON'])(
    'an Endpoint named %s, a name of every object or one JavaScript reads, fails the name grammar',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])])).toMatchObject({
        kind: 'invalid',
        failures: [
          { at: ['groups', 'orders', 'endpoints', 'GET /orders', 'name'], rule: 'name-grammar' },
        ],
      });
    },
  );

  test.each(['thenable', 'toStringValue', 'getConstructor'])(
    'an Endpoint named %s, which only contains a reserved name, is valid',
    (name) => {
      const endpoint = defineEndpoint({ ...listing, name });

      expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
    },
  );

  test.each(['class', 'arguments', 'handle', 'toString'])(
    'a Guard named %s, in a Definitions Package too, fails',
    (name) => {
      const guard = defineGuard({ name, description: 'A guard' });
      const definitions = defineDefinitions({ name: 'definitions', guards: [guard] });

      expect(validateInPackage(definitions, noOrigin)).toEqual(
        failed(
          ['guards', name, 'name'],
          'name-grammar',
          `A Guard name is camelCase words and no reserved word: ${name}`,
        ),
      );
    },
  );

  test('a path param named as a reserved word is still allowed', () => {
    const endpoint = defineEndpoint({
      ...listing,
      path: '/orders/:class',
      input: { params: z.object({ class: z.string() }) },
    });

    expect(validateGroups([aGroup('orders', [endpoint])]).kind).toBe('valid');
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

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(['name'], 'name-grammar', 'A Definitions Package name is kebab-case: Definitions'),
    );
  });

  test('a Standard Rejection code a Definitions Package declares follows the code grammar', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'not-found', status: 404, message: 'Not found' } },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
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

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['guards', 'apiKey', 'name'],
        'duplicate-guard-name',
        'A Guard name is unique across the Contract and its Definitions Packages: apiKey',
      ),
    );
  });

  test('a Guard named like an attached one, reached only through another Guard’s guards, fails as a duplicate', () => {
    const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
    const anotherApiKey = defineGuard({ name: 'apiKey', description: 'Another key' });
    const session = defineGuard({
      name: 'session',
      description: 'Builds on another key',
      guards: [anotherApiKey],
    });
    const endpoint = defineEndpoint({ ...listing, guards: [apiKey, session] });

    const validated = validateGroups([aGroup('orders', [endpoint])]);

    expect(validated).toEqual(
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

describe('validateContract: listed Definitions Packages', () => {
  test('a Definitions Package listed twice fails', () => {
    const definitions = defineDefinitions({ name: 'definitions' });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions, definitions],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['definitions', 1, 'name'],
        'duplicate-definitions-name',
        'A Contract lists each Definitions Package once, under a name of its own: definitions',
      ),
    );
  });

  test('a Definitions Package with Standard Rejections listed twice fails only as a duplicate', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
    });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions, definitions],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['definitions', 1, 'name'],
        'duplicate-definitions-name',
        'A Contract lists each Definitions Package once, under a name of its own: definitions',
      ),
    );
  });

  test('two listed Definitions Packages with one name fail', () => {
    const first = defineDefinitions({ name: 'definitions' });
    const second = defineDefinitions({ name: 'definitions' });
    const contract = defineContract({ name: 'orders-service', definitions: [first, second] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['definitions', 1, 'name'],
        'duplicate-definitions-name',
        'A Contract lists each Definitions Package once, under a name of its own: definitions',
      ),
    );
  });
});

describe('validateContract: Groups', () => {
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
});

describe('validateContract: the root is named as its package', () => {
  const roots = [
    ['a Contract', defineContract({ name: 'orders-service', groups: [] })],
    ['an Application', defineApplication({ name: 'orders-service', dependencies: [] })],
    ['a Definitions Package', defineDefinitions({ name: 'orders-service' })],
  ] as const;

  test.each(roots)('%s named as its package.json without the scope is valid', (_, root) => {
    const validated = validateContract(root, {
      originOf: noOrigin,
      packageName: 'orders-service',
      exportsOf: () => [],
    });

    expect(validated.kind).toBe('valid');
  });

  test.each(roots)('%s named otherwise fails package-name', (_, root) => {
    const validated = validateContract(root, {
      originOf: noOrigin,
      packageName: 'billing-service',
      exportsOf: () => [],
    });

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['name'],
          rule: 'package-name',
          message: 'A root is named as its package.json, without the scope: billing-service',
        },
      ],
    });
  });

  test('a wrong package name is reported with every other failure at once', () => {
    const root = defineContract({ name: 'Orders', groups: [] });

    const validated = validateContract(root, {
      originOf: noOrigin,
      packageName: 'orders',
      exportsOf: () => [],
    });

    const rules = validated.kind === 'invalid' ? validated.failures.map(ruleOf) : [];
    expect(rules).toEqual(['name-grammar', 'package-name']);
  });
});

function ruleOf(failure: { readonly kind: string } & { readonly rule?: string }): string {
  return failure.rule ?? failure.kind;
}
