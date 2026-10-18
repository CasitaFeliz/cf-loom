import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Contract,
  type Definitions,
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  type Group,
  type Guard,
  type Rejection,
} from '../index.ts';
import { type OriginOf, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: OriginOf) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  return validateContract(root, { originOf, packageName: typeof name === 'string' ? name : '' });
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

/** What a cast lets an author put where a declaration belongs. */
function anything<Wanted>(value: unknown): Wanted {
  return value as Wanted;
}

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(defineContract({ name: 'orders-service', groups: [orders] }), noOrigin);
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: a root that is not one', () => {
  test('a null root is invalid, not an exception', () => {
    expect(validateInPackage(anything<Contract>(null), noOrigin)).toEqual(
      failed([], 'not-a-root', 'A root is a Contract, an Application or a Definitions Package'),
    );
  });

  test('a root with an unknown kind fails', () => {
    const root = anything<Contract>({ kind: 'service', name: 'orders-service' });

    expect(validateInPackage(root, noOrigin)).toEqual(
      failed([], 'not-a-root', 'A root is a Contract, an Application or a Definitions Package'),
    );
  });

  test('an unbranded object with a root kind is not a declaration', () => {
    const root = anything<Contract>({ kind: 'contract', name: 'orders-service' });

    expect(validateInPackage(root, noOrigin)).toEqual(
      failed([], 'not-a-root', 'A root is a Contract, an Application or a Definitions Package'),
    );
  });
});

describe('validateContract: lists and their items', () => {
  test('a root list that is not a list fails', () => {
    const contract = defineContract({
      name: 'orders-service',
      groups: anything<readonly Group[]>('orders'),
    });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(['groups'], 'not-a-list', 'groups is a list'),
    );
  });

  test('a null Group fails as not a declaration', () => {
    const contract = defineContract({
      name: 'orders-service',
      groups: anything<readonly Group[]>([null]),
    });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(['groups', 0], 'not-a-declaration', 'groups.0 is not a Group'),
    );
  });

  test('a null Definitions Package and a null Dependency fail as not declarations', () => {
    const contract = defineContract({
      name: 'orders-service',
      definitions: anything<readonly Definitions[]>([null]),
      dependencies: anything<readonly never[]>([null]),
    });

    expect(validateInPackage(contract, noOrigin)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['definitions', 0],
          rule: 'not-a-declaration',
          message: 'definitions.0 is not a Definitions Package',
        },
        {
          kind: 'declaration',
          at: ['dependencies', 0],
          rule: 'not-a-declaration',
          message: 'dependencies.0 is not a Dependency',
        },
      ],
    });
  });

  test('a Group’s Endpoint that is not one fails', () => {
    const orders = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: anything<readonly [Endpoint]>([{ name: 'listOrders' }]),
    });

    expect(
      validateInPackage(defineContract({ name: 'orders-service', groups: [orders] }), noOrigin),
    ).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 0],
        'not-a-declaration',
        'endpoints.0 is not an Endpoint',
      ),
    );
  });

  test('an Endpoint’s rejections item that is no Rejection fails', () => {
    const rejections = anything<readonly Rejection[]>([{ code: 'ORDER_LOCKED', status: 409 }]);

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections }))).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'rejections', 0],
        'not-a-declaration',
        'rejections.0 is not a Rejection',
      ),
    );
  });

  test('a Guard’s guards item that is no Guard fails', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      guards: anything<readonly Guard[]>(['userToken']),
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [tenant] }))).toEqual(
      failed(['guards', 'tenant', 'guards', 0], 'not-a-declaration', 'guards.0 is not a Guard'),
    );
  });

  test('a Guard’s rejections that is not a list fails', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      rejections: anything<readonly Rejection[]>({}),
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [tenant] }))).toEqual(
      failed(['guards', 'tenant', 'rejections'], 'not-a-list', 'rejections is a list'),
    );
  });

  test('a null Standard Rejection entry fails', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: anything<Record<string, never>>({ notFound: null }),
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(['standardRejections', 'notFound'], 'not-an-object', 'notFound is an object'),
    );
  });

  test('an Endpoint’s guards that is not a list fails', () => {
    const endpoint = defineEndpoint({ ...listing, guards: anything<readonly Guard[]>('apiKey') });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'guards'],
        'not-a-list',
        'guards is a list',
      ),
    );
  });

  test('an Endpoint’s success that is no object fails once', () => {
    const endpoint = defineEndpoint({ ...listing, success: anything<typeof listing.success>('x') });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'success'],
        'not-an-object',
        'success is an object',
      ),
    );
  });

  test('an Endpoint’s input that is no object fails', () => {
    const endpoint = defineEndpoint({ ...listing, input: anything<{ headers: z.ZodObject }>('x') });

    expect(validateEndpoint(endpoint)).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'input'],
        'not-an-object',
        'input is an object',
      ),
    );
  });

  test('a Guard’s demands that is no object fails', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      demands: anything<{ headers: z.ZodObject }>('x'),
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [tenant] }))).toEqual(
      failed(['guards', 'tenant', 'demands'], 'not-an-object', 'demands is an object'),
    );
  });

  test('a Definitions Package’s schemas that is null fails', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      schemas: anything<Record<string, never>>(null),
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(['schemas'], 'not-an-object', 'schemas is an object'),
    );
  });

  test('a standardRejections that is a string fails once', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: anything<Record<string, never>>('abc'),
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(['standardRejections'], 'not-an-object', 'standardRejections is an object'),
    );
  });

  test('a standardRejections that is a list fails once', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: anything<Record<string, never>>([
        { code: 'X', status: 400, message: 'x' },
      ]),
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(['standardRejections'], 'not-an-object', 'standardRejections is an object'),
    );
  });

  test('a hole in groups fails as not a declaration', () => {
    const groups: Group[] = [];
    groups[1] = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [defineEndpoint(listing)],
    });

    expect(validateInPackage(defineContract({ name: 'orders-service', groups }), noOrigin)).toEqual(
      failed(['groups', 0], 'not-a-declaration', 'groups.0 is not a Group'),
    );
  });

  test('two Groups each with a hole fail once per hole', () => {
    const orders: Endpoint[] = [];
    orders[1] = defineEndpoint(listing);
    const sales: Endpoint[] = [];
    sales[1] = defineEndpoint({ ...listing, name: 'listSales', path: '/sales' });
    const contract = defineContract({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'orders',
          description: 'Orders',
          endpoints: anything<readonly [Endpoint]>(orders),
        }),
        defineGroup({
          name: 'sales',
          description: 'Sales',
          endpoints: anything<readonly [Endpoint]>(sales),
        }),
      ],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['groups', 'orders', 'endpoints', 0],
          rule: 'not-a-declaration',
          message: 'endpoints.0 is not an Endpoint',
        },
        {
          kind: 'declaration',
          at: ['groups', 'sales', 'endpoints', 0],
          rule: 'not-a-declaration',
          message: 'endpoints.0 is not an Endpoint',
        },
      ],
    });
  });

  test('a hole in an Endpoint’s guards fails once, as no Attachment', () => {
    const guards: Guard[] = [];
    guards[1] = defineGuard({ name: 'apiKey', description: 'A key' });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards }))).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'guards', 0],
        'not-an-attachment',
        'An Attachment is a Guard or { guard, qualifier }',
      ),
    );
  });

  test('a declaration that is no Attachment in guards fails once', () => {
    const locked = anything<Guard>(
      defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' }),
    );

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [locked] }))).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'guards', 0],
        'not-an-attachment',
        'An Attachment is a Guard or { guard, qualifier }',
      ),
    );
  });

  test('a malformed root is invalid without throwing', () => {
    const contract = defineContract({
      name: 'orders-service',
      groups: anything<readonly Group[]>([
        null,
        defineGroup({
          name: 'orders',
          description: 'Orders',
          endpoints: anything<readonly [Endpoint]>([
            'listOrders',
            defineEndpoint({
              ...listing,
              guards: anything<readonly Guard[]>([null, 'x']),
              rejections: anything<readonly Rejection[]>([null]),
            }),
          ]),
        }),
      ]),
      definitions: anything<readonly Definitions[]>('definitions'),
      dependencies: anything<readonly never[]>([{}]),
    });

    expect(validateInPackage(contract, noOrigin).kind).toBe('invalid');
  });
});
