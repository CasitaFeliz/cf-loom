import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Attachment,
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

const quota = defineGuard({
  name: 'quota',
  description: 'The client stays within a quota',
  qualifier: z.object({ perMinute: z.int() }),
});

/** A declaration with a field its kind does not declare, as a cast lets an author write it. */
function withField<Declaration>(declaration: Declaration, field: string): Declaration {
  return { ...declaration, [field]: 'anything' };
}

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateContract(defineContract({ name: 'orders-service', groups: [orders] }), noOrigin);
}

function undeclared(at: readonly (string | number)[]) {
  return {
    kind: 'invalid',
    failures: [
      {
        kind: 'declaration',
        at,
        rule: 'undeclared-field',
        message: `${String(at.at(-1))} is not a declared field`,
      },
    ],
  };
}

describe('validateContract: undeclared fields', () => {
  test('a Contract with only declared fields validates', () => {
    const orders = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [
        defineEndpoint({ ...listing, guards: [{ guard: quota, qualifier: { perMinute: 1 } }] }),
      ],
    });
    const contract = defineContract({ name: 'orders-service', groups: [orders], definitions: [] });

    expect(validateContract(contract, noOrigin).kind).toBe('valid');
  });

  test('an undeclared field on a Contract fails', () => {
    const contract: Contract = withField(defineContract({ name: 'orders-service' }), 'events');

    expect(validateContract(contract, noOrigin)).toEqual(undeclared(['events']));
  });

  test('an undeclared field on an Application fails', () => {
    const application = {
      kind: 'application',
      name: 'web-admin',
      dependencies: [],
      groups: [],
    } as const;

    expect(validateContract(application, noOrigin)).toEqual(undeclared(['groups']));
  });

  test('an undeclared field on a Definitions Package fails', () => {
    const definitions: Definitions = withField(
      defineDefinitions({ name: 'definitions' }),
      'endpoints',
    );

    expect(validateContract(definitions, noOrigin)).toEqual(undeclared(['endpoints']));
  });

  test('an undeclared field on a listed Definitions Package fails where it is listed', () => {
    const definitions: Definitions = withField(
      defineDefinitions({ name: 'definitions' }),
      'endpoints',
    );
    const contract = defineContract({ name: 'orders-service', definitions: [definitions] });

    expect(validateContract(contract, noOrigin)).toEqual(
      undeclared(['definitions', 'definitions', 'endpoints']),
    );
  });

  test('an undeclared field on a Group fails', () => {
    const orders = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [defineEndpoint(listing)],
    });
    const group: Group = withField(orders, 'prefix');

    expect(
      validateContract(defineContract({ name: 'orders-service', groups: [group] }), noOrigin),
    ).toEqual(undeclared(['groups', 'orders', 'prefix']));
  });

  test('an undeclared field on an Endpoint fails', () => {
    const endpoint: Endpoint = withField(defineEndpoint(listing), 'group');

    expect(validateEndpoint(endpoint)).toEqual(
      undeclared(['groups', 'orders', 'endpoints', 'listOrders', 'group']),
    );
  });

  test('an undeclared field in an Endpoint’s input fails', () => {
    const input = { querry: z.object({ page: z.int() }) } as unknown as { query: z.ZodObject };
    const endpoint = defineEndpoint({ ...listing, input });

    expect(validateEndpoint(endpoint)).toEqual(
      undeclared(['groups', 'orders', 'endpoints', 'listOrders', 'input', 'querry']),
    );
  });

  test('an undeclared field in an Endpoint’s success fails', () => {
    const success = { ...listing.success, bdy: z.string() } as unknown as typeof listing.success;
    const endpoint = defineEndpoint({ ...listing, success });

    expect(validateEndpoint(endpoint)).toEqual(
      undeclared(['groups', 'orders', 'endpoints', 'listOrders', 'success', 'bdy']),
    );
  });

  test('an undeclared field on a Guard fails', () => {
    const guard: Guard = withField(
      defineGuard({ name: 'apiKey', description: 'A key' }),
      'audience',
    );

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [guard] }))).toEqual(
      undeclared(['guards', 'apiKey', 'audience']),
    );
  });

  test('an undeclared field in a Guard’s demands fails', () => {
    const demands = { header: z.object({ 'x-api-key': z.string() }) } as unknown as {
      headers: z.ZodObject;
    };
    const apiKey = defineGuard({ name: 'apiKey', description: 'A key', demands });

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [apiKey] }))).toEqual(
      undeclared(['guards', 'apiKey', 'demands', 'header']),
    );
  });

  test('an undeclared field on a Rejection fails', () => {
    const locked = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });
    const rejection: Rejection = withField(locked, 'detail');

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      undeclared(['rejections', 'ORDER_LOCKED', 'detail']),
    );
  });

  test('an undeclared field on a qualified Attachment fails', () => {
    const guards = [
      { guard: quota, qualifier: { perMinute: 60 }, reason: 'audit' },
    ] as unknown as readonly Attachment[];

    expect(validateEndpoint(defineEndpoint({ ...listing, guards }))).toEqual(
      undeclared(['groups', 'orders', 'endpoints', 'listOrders', 'guards', 0, 'reason']),
    );
  });

  test('an undeclared Standard Rejection fails', () => {
    const standardRejections = {
      notFund: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    } as unknown as { notFound: { code: 'NOT_FOUND'; status: 404; message: 'Not found' } };
    const definitions = defineDefinitions({ name: 'definitions', standardRejections });

    expect(validateContract(definitions, noOrigin)).toEqual(
      undeclared(['standardRejections', 'notFund']),
    );
  });

  test('a body on a Standard Rejection fails as an undeclared field', () => {
    const notFound = {
      code: 'NOT_FOUND',
      status: 404,
      message: 'Not found',
      body: z.object({ resource: z.string() }),
    } as unknown as { code: 'NOT_FOUND'; status: 404; message: 'Not found' };
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound },
    });

    expect(validateContract(definitions, noOrigin)).toEqual(
      undeclared(['standardRejections', 'notFound', 'body']),
    );
  });
});
