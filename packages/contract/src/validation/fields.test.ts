import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Attachment,
  type ContractPackage,
  defineApplication,
  defineContract,
  defineDefinitions,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
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

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: { listOrders: defineEndpoint(listing) },
  events: {},
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
} as const satisfies ContractPackage;

/** A declaration written with a field its kind does not declare, as a cast lets an author. */
function withField<Declaration extends object>(
  declaration: Declaration,
  field: string,
): Declaration {
  return { ...declaration, [field]: 'anything' };
}

/**
 * A copy of a declaration that still counts as one, as a declaration of another copy of this
 * package does: `defineDependencies` builds its object itself, so no author writes a field on it.
 */
function branded<Declaration extends object>(declaration: Declaration): Declaration {
  const brand = Symbol.for('@casitafeliz/loom-contract.declaration');
  return Object.defineProperty(declaration, brand, { value: true });
}

/** A declaration written without a field its kind requires, as a cast lets an author. */
function withoutField<Declaration extends object>(
  declaration: Declaration,
  field: string,
): Declaration {
  const { [field]: _removed, ...rest } = declaration as Record<string, unknown>;
  return rest as Declaration;
}

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateContract(defineContract({ name: 'orders-service', groups: [orders] }), noOrigin);
}

function undeclared(at: readonly (string | number)[]) {
  return failed(at, 'undeclared-field', `${String(at.at(-1))} is not a declared field`);
}

function required(at: readonly (string | number)[], message: string) {
  return failed(at, 'required-field', message);
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

const endpointAt = ['groups', 'orders', 'endpoints', 'GET /orders'];

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
    const contract = defineContract(withField({ name: 'orders-service' }, 'events'));

    expect(validateContract(contract, noOrigin)).toEqual(undeclared(['events']));
  });

  test('an undeclared field on an Application fails', () => {
    const application = defineApplication(
      withField({ name: 'web-admin', dependencies: [] }, 'groups'),
    );

    expect(validateContract(application, noOrigin)).toEqual(undeclared(['groups']));
  });

  test('an undeclared field on a Definitions Package fails', () => {
    const definitions = defineDefinitions(withField({ name: 'definitions' }, 'endpoints'));

    expect(validateContract(definitions, noOrigin)).toEqual(undeclared(['endpoints']));
  });

  test('an undeclared field on a listed Definitions Package fails where it is listed', () => {
    const definitions = defineDefinitions(withField({ name: 'definitions' }, 'endpoints'));
    const contract = defineContract({ name: 'orders-service', definitions: [definitions] });

    expect(validateContract(contract, noOrigin)).toEqual(
      undeclared(['definitions', 'definitions', 'endpoints']),
    );
  });

  test('an undeclared field on a Group fails', () => {
    const group = defineGroup(
      withField(
        { name: 'orders', description: 'Orders', endpoints: [defineEndpoint(listing)] as const },
        'prefix',
      ),
    );

    expect(
      validateContract(defineContract({ name: 'orders-service', groups: [group] }), noOrigin),
    ).toEqual(undeclared(['groups', 'orders', 'prefix']));
  });

  test('an undeclared field on an Endpoint fails', () => {
    const endpoint = defineEndpoint(withField(listing, 'group'));

    expect(validateEndpoint(endpoint)).toEqual(undeclared([...endpointAt, 'group']));
  });

  test('an undeclared field in an Endpoint’s input fails', () => {
    const input = { querry: z.object({ page: z.int() }) } as unknown as { query: z.ZodObject };
    const endpoint = defineEndpoint({ ...listing, input });

    expect(validateEndpoint(endpoint)).toEqual(undeclared([...endpointAt, 'input', 'querry']));
  });

  test('an undeclared field in an Endpoint’s success fails', () => {
    const success = { ...listing.success, bdy: z.string() } as unknown as typeof listing.success;
    const endpoint = defineEndpoint({ ...listing, success });

    expect(validateEndpoint(endpoint)).toEqual(undeclared([...endpointAt, 'success', 'bdy']));
  });

  test('an undeclared field on a Guard fails', () => {
    const guard = defineGuard(withField({ name: 'apiKey', description: 'A key' }, 'audience'));

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
    const rejection = defineRejection(
      withField({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' } as const, 'detail'),
    );

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      undeclared(['rejections', 'ORDER_LOCKED', 'detail']),
    );
  });

  test('an undeclared field on a qualified Attachment fails', () => {
    const guards = [
      { guard: quota, qualifier: { perMinute: 60 }, reason: 'audit' },
    ] as unknown as readonly Attachment[];

    expect(validateEndpoint(defineEndpoint({ ...listing, guards }))).toEqual(
      undeclared([...endpointAt, 'guards', 0, 'reason']),
    );
  });

  test('an undeclared field on a Dependency fails', () => {
    const paymentsDeps = defineDependencies(payments, {});
    const dependencies = [branded(withField(paymentsDeps, 'version'))];
    const contract = defineContract({ name: 'orders-service', dependencies });

    expect(validateContract(contract, noOrigin)).toEqual(
      undeclared(['dependencies', 'payments-service', 'version']),
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

describe('validateContract: required fields', () => {
  test('a root without a name fails', () => {
    const contract = defineContract(withoutField({ name: 'orders-service' }, 'name'));

    expect(validateContract(contract, noOrigin)).toEqual(
      required(['name'], 'name is a required string'),
    );
  });

  test('a name that is not a string fails once', () => {
    const contract = defineContract({ name: 7 as unknown as string });

    expect(validateContract(contract, noOrigin)).toEqual(
      required(['name'], 'name is a required string'),
    );
  });

  test('an Application without dependencies fails', () => {
    const application = defineApplication(
      withoutField({ name: 'web-admin', dependencies: [] }, 'dependencies'),
    );

    expect(validateContract(application, noOrigin)).toEqual(
      required(['dependencies'], 'dependencies is a required field'),
    );
  });

  test('a Group without a description fails', () => {
    const group = defineGroup(
      withoutField(
        { name: 'orders', description: 'Orders', endpoints: [defineEndpoint(listing)] as const },
        'description',
      ),
    );

    expect(
      validateContract(defineContract({ name: 'orders-service', groups: [group] }), noOrigin),
    ).toEqual(required(['groups', 'orders', 'description'], 'description is a required string'));
  });

  test('an Endpoint without a description fails', () => {
    const endpoint = defineEndpoint(withoutField(listing, 'description'));

    expect(validateEndpoint(endpoint)).toEqual(
      required([...endpointAt, 'description'], 'description is a required string'),
    );
  });

  test('an Endpoint without a success fails once', () => {
    const endpoint = defineEndpoint(withoutField(listing, 'success'));

    expect(validateEndpoint(endpoint)).toEqual(
      required([...endpointAt, 'success'], 'success is a required field'),
    );
  });

  test('a Success without a status fails once', () => {
    const success = { body: listing.success.body } as unknown as typeof listing.success;
    const endpoint = defineEndpoint({ ...listing, success });

    expect(validateEndpoint(endpoint)).toEqual(
      required([...endpointAt, 'success', 'status'], 'status is a required field'),
    );
  });

  test('an Endpoint without a method fails once', () => {
    const endpoint = defineEndpoint(withoutField(listing, 'method'));

    expect(validateEndpoint(endpoint)).toEqual(
      required(
        ['groups', 'orders', 'endpoints', 'undefined /orders', 'method'],
        'method is a required field',
      ),
    );
  });

  test('a Guard without a description fails', () => {
    const guard = defineGuard(
      withoutField({ name: 'apiKey', description: 'A key' }, 'description'),
    );

    expect(validateEndpoint(defineEndpoint({ ...listing, guards: [guard] }))).toEqual(
      required(['guards', 'apiKey', 'description'], 'description is a required string'),
    );
  });

  test('a Rejection without a message fails', () => {
    const rejection = defineRejection(
      withoutField({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' } as const, 'message'),
    );

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      required(['rejections', 'ORDER_LOCKED', 'message'], 'message is a required string'),
    );
  });

  test('a Standard Rejection declared without a code fails', () => {
    const notFound = { status: 404, message: 'Not found' } as unknown as {
      code: 'NOT_FOUND';
      status: 404;
      message: 'Not found';
    };
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound },
    });

    expect(validateContract(definitions, noOrigin)).toEqual(
      required(['standardRejections', 'notFound', 'code'], 'code is a required string'),
    );
  });

  test('a qualified Attachment without a qualifier fails', () => {
    const guards = [{ guard: quota }] as unknown as readonly Attachment[];

    expect(validateEndpoint(defineEndpoint({ ...listing, guards }))).toEqual(
      required([...endpointAt, 'guards', 0, 'qualifier'], 'qualifier is a required field'),
    );
  });
});
