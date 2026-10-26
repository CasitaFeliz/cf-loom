import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  type Definitions,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
  type Group,
  type Guard,
  type Rejection,
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

/** What a cast lets an author put where a declaration belongs. */
function anything<Wanted>(value: unknown): Wanted {
  return value as Wanted;
}

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(defineService({ name: 'orders-service', groups: [orders] }));
}

function failed(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

describe('validateRoot: lists and their items', () => {
  test('a Root’s list that is not a list fails', () => {
    const contract = defineService({
      name: 'orders-service',
      groups: anything<readonly Group[]>('orders'),
    });

    expect(validateInPackage(contract)).toEqual(
      failed('(root) groups', 'not-a-list', 'groups is a list'),
    );
  });

  test('a null Group fails as not a declaration', () => {
    const contract = defineService({
      name: 'orders-service',
      groups: anything<readonly Group[]>([null]),
    });

    expect(validateInPackage(contract)).toEqual(
      failed('(root) groups[0]', 'not-a-declaration', 'is not a Group'),
    );
  });

  test('a standardRejections that is no Definitions Package and a null Dependency fail as not declarations', () => {
    const contract = defineService({
      name: 'orders-service',
      standardRejections: anything<Definitions>({ notFound: { code: 'GONE' } }),
      dependencies: anything<readonly never[]>([null]),
    });

    expect(validateInPackage(contract)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: '(root) standardRejections',
          rule: 'not-a-declaration',
          message: "A Contract's standardRejections is a Definitions Package's definitions",
        },
        {
          kind: 'declaration',
          location: '(root) dependencies[0]',
          rule: 'not-a-declaration',
          message: 'is not a Dependency',
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

    expect(validateInPackage(defineService({ name: 'orders-service', groups: [orders] }))).toEqual(
      failed('groups.orders endpoints[0]', 'not-a-declaration', 'is not an Endpoint'),
    );
  });

  test('an Endpoint’s rejections item that is no Rejection fails', () => {
    const rejections = anything<readonly Rejection[]>([{ code: 'ORDER_LOCKED', status: 409 }]);

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections }))).toEqual(
      failed(
        'endpoints.GET /orders (listOrders) rejections[0]',
        'not-a-declaration',
        'is not a Rejection',
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
      failed('guards.tenant guards[0]', 'not-a-declaration', 'is not a Guard'),
    );
  });

  test('a Guard’s rejections that is not a list fails', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      rejections: anything<readonly Rejection[]>({}),
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [tenant] }))).toEqual(
      failed('guards.tenant rejections', 'not-a-list', 'rejections is a list'),
    );
  });

  test('a null Standard Rejection entry fails', () => {
    const definitions = defineDefinitions({
      standardRejections: anything<Record<string, never>>({ notFound: null }),
    });

    expect(validateInPackage(definitions)).toEqual(
      failed('(root) standardRejections.notFound', 'not-an-object', 'notFound is an object'),
    );
  });

  test('an Endpoint’s guards that is not a list fails', () => {
    const endpoint = defineEndpoint({ ...listing, guards: anything<readonly Guard[]>('apiKey') });

    expect(validateEndpoint(endpoint)).toEqual(
      failed('endpoints.GET /orders (listOrders) guards', 'not-a-list', 'guards is a list'),
    );
  });

  test('an Endpoint’s success that is no object fails once', () => {
    const endpoint = defineEndpoint({ ...listing, success: anything<typeof listing.success>('x') });

    expect(validateEndpoint(endpoint)).toEqual(
      failed('endpoints.GET /orders (listOrders) success', 'not-an-object', 'success is an object'),
    );
  });

  test('an Endpoint’s input that is no object fails', () => {
    const endpoint = defineEndpoint({ ...listing, input: anything<{ headers: z.ZodObject }>('x') });

    expect(validateEndpoint(endpoint)).toEqual(
      failed('endpoints.GET /orders (listOrders) input', 'not-an-object', 'input is an object'),
    );
  });

  test('a Guard’s demands that is no object fails', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      demands: anything<{ headers: z.ZodObject }>('x'),
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [tenant] }))).toEqual(
      failed('guards.tenant demands', 'not-an-object', 'demands is an object'),
    );
  });

  test('a standardRejections that is a string fails once', () => {
    const definitions = defineDefinitions({
      standardRejections: anything<Record<string, never>>('abc'),
    });

    expect(validateInPackage(definitions)).toEqual(
      failed('(root) standardRejections', 'not-an-object', 'standardRejections is an object'),
    );
  });

  test('a standardRejections that is a list fails once', () => {
    const definitions = defineDefinitions({
      standardRejections: anything<Record<string, never>>([
        { code: 'X', status: 400, message: 'x' },
      ]),
    });

    expect(validateInPackage(definitions)).toEqual(
      failed('(root) standardRejections', 'not-an-object', 'standardRejections is an object'),
    );
  });

  test('a hole in groups fails as not a declaration', () => {
    const groups: Group[] = [];
    groups[1] = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [defineEndpoint(listing)],
    });

    expect(validateInPackage(defineService({ name: 'orders-service', groups }))).toEqual(
      failed('(root) groups[0]', 'not-a-declaration', 'is not a Group'),
    );
  });

  test('two Groups each with a hole fail once per hole', () => {
    const orders: Endpoint[] = [];
    orders[1] = defineEndpoint(listing);
    const sales: Endpoint[] = [];
    sales[1] = defineEndpoint({ ...listing, name: 'listSales', path: '/sales' });
    const contract = defineService({
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

    expect(validateInPackage(contract)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'groups.orders endpoints[0]',
          rule: 'not-a-declaration',
          message: 'is not an Endpoint',
        },
        {
          kind: 'declaration',
          location: 'groups.sales endpoints[0]',
          rule: 'not-a-declaration',
          message: 'is not an Endpoint',
        },
      ],
    });
  });

  test('a hole in an Endpoint’s guards fails once, as no Attachment', () => {
    const guards: Guard[] = [];
    guards[1] = defineGuard({ name: 'apiKey', description: 'A key' });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards }))).toEqual(
      failed(
        'endpoints.GET /orders (listOrders) guards[0]',
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
        'endpoints.GET /orders (listOrders) guards[0]',
        'not-an-attachment',
        'An Attachment is a Guard or { guard, qualifier }',
      ),
    );
  });

  test('a malformed Root is invalid without throwing', () => {
    const contract = defineService({
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
      standardRejections: anything<Definitions>('definitions'),
      dependencies: anything<readonly never[]>([{}]),
    });

    expect(validateInPackage(contract).kind).toBe('invalid');
  });
});
