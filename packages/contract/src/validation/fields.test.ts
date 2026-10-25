import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import {
  type Attachment,
  defineApplication,
  defineCommand,
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineSubscription,
  type Endpoint,
} from '../index.ts';
import { type RootPackage, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  return validateContract(root, aRootPackage(root, { originOf }));
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

const quota = defineGuard({
  name: 'quota',
  description: 'The Caller stays within a quota',
  qualifier: z.object({ perMinute: z.int() }),
});

/** A declaration written with a field its kind does not declare, as a cast lets an author. */
function withField<Declaration extends object>(
  declaration: Declaration,
  field: string,
): Declaration {
  return { ...declaration, [field]: 'anything' };
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
  return validateInPackage(defineContract({ name: 'orders-service', groups: [orders] }), noOrigin);
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

    expect(validateInPackage(contract, noOrigin).kind).toBe('valid');
  });

  test('an undeclared field on a Contract fails', () => {
    const contract = defineContract(withField({ name: 'orders-service' }, 'endpoints'));

    expect(validateInPackage(contract, noOrigin)).toEqual(undeclared(['endpoints']));
  });

  test('an undeclared field on an Application fails', () => {
    const application = defineApplication(
      withField({ name: 'web-admin', dependencies: [] }, 'groups'),
    );

    expect(validateInPackage(application, noOrigin)).toEqual(undeclared(['groups']));
  });

  test('an undeclared field on a Definitions Package fails', () => {
    const definitions = defineDefinitions(withField({}, 'endpoints'));

    expect(validateInPackage(definitions, noOrigin)).toEqual(undeclared(['endpoints']));
  });

  test('an undeclared field on a listed Definitions Package fails where it is listed', () => {
    const definitions = defineDefinitions(withField({}, 'endpoints'));
    const contract = defineContract({ name: 'orders-service', definitions: [definitions] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      undeclared(['definitions', 0, 'endpoints']),
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
      validateInPackage(defineContract({ name: 'orders-service', groups: [group] }), noOrigin),
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

  test('an undeclared Standard Rejection fails', () => {
    const standardRejections = {
      notFund: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    } as unknown as { notFound: { code: 'NOT_FOUND'; status: 404; message: 'Not found' } };
    const definitions = defineDefinitions({ standardRejections });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
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
      standardRejections: { notFound },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      undeclared(['standardRejections', 'notFound', 'body']),
    );
  });
});

describe('validateContract: required fields', () => {
  test('a root without a name fails', () => {
    const contract = defineContract(withoutField({ name: 'orders-service' }, 'name'));

    expect(validateInPackage(contract, noOrigin)).toEqual(
      required(['name'], 'name is a required string'),
    );
  });

  test('a name that is not a string fails once', () => {
    const contract = defineContract({ name: 7 as unknown as string });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(['name'], 'not-a-string', 'name is a string'),
    );
  });

  test('a null success counts as missing', () => {
    const endpoint = defineEndpoint({
      ...listing,
      success: null as unknown as typeof listing.success,
    });

    expect(validateEndpoint(endpoint)).toEqual(
      required([...endpointAt, 'success'], 'success is a required field'),
    );
  });

  test('a null Success status counts as missing, once', () => {
    const success = {
      status: null,
      body: listing.success.body,
    } as unknown as typeof listing.success;
    const endpoint = defineEndpoint({ ...listing, success });

    expect(validateEndpoint(endpoint)).toEqual(
      required([...endpointAt, 'success', 'status'], 'status is a required field'),
    );
  });

  test('a null Rejection status counts as missing, once', () => {
    const rejection = defineRejection({
      code: 'ORDER_LOCKED',
      status: null as unknown as 409,
      message: 'Locked',
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      required(['rejections', 'ORDER_LOCKED', 'status'], 'status is a required field'),
    );
  });

  test('a null Rejection body fails once, as no schema', () => {
    const rejection = defineRejection({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      body: null as unknown as z.ZodString,
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(['rejections', 'ORDER_LOCKED', 'body'], 'not-a-schema', 'body is not a zod schema'),
    );
  });

  test('a null Standard Rejection status counts as missing, once', () => {
    const notFound = { code: 'NOT_FOUND', status: null, message: 'Not found' } as unknown as {
      code: 'NOT_FOUND';
      status: 404;
      message: 'Not found';
    };
    const definitions = defineDefinitions({
      standardRejections: { notFound },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      required(['standardRejections', 'notFound', 'status'], 'status is a required field'),
    );
  });

  test('a Rejection status that is an object without a prototype is named without throwing', () => {
    const rejection = defineRejection({
      code: 'ORDER_LOCKED',
      status: Object.create(null) as 409,
      message: 'Locked',
    });

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(
        ['rejections', 'ORDER_LOCKED', 'status'],
        'rejection-status',
        "A Rejection's status is 4xx: an object",
      ),
    );
  });

  test('an Application whose dependencies is null fails once, as no list', () => {
    const application = defineApplication({
      name: 'web-admin',
      dependencies: null as unknown as readonly never[],
    });

    expect(validateInPackage(application, noOrigin)).toEqual(
      failed(['dependencies'], 'not-a-list', 'dependencies is a list'),
    );
  });

  test('a null lifecycle fails once, as no string', () => {
    const endpoint = defineEndpoint({ ...listing, lifecycle: null as unknown as 'active' });

    expect(validateEndpoint(endpoint)).toEqual(
      failed([...endpointAt, 'lifecycle'], 'not-a-string', 'lifecycle is a string'),
    );
  });

  test('a null optional list fails once, as no list', () => {
    const endpoint = defineEndpoint({ ...listing, guards: null as unknown as readonly never[] });

    expect(validateEndpoint(endpoint)).toEqual(
      failed([...endpointAt, 'guards'], 'not-a-list', 'guards is a list'),
    );
  });

  test('a null optional object part fails once, as no object', () => {
    const endpoint = defineEndpoint({
      ...listing,
      input: null as unknown as { headers: z.ZodObject },
    });

    expect(validateEndpoint(endpoint)).toEqual(
      failed([...endpointAt, 'input'], 'not-an-object', 'input is an object'),
    );
  });

  test('an Application without dependencies validates', () => {
    const application = defineApplication({ name: 'web-admin' });

    expect(validateInPackage(application, noOrigin).kind).toBe('valid');
  });

  test('a Group without a description fails', () => {
    const group = defineGroup(
      withoutField(
        { name: 'orders', description: 'Orders', endpoints: [defineEndpoint(listing)] as const },
        'description',
      ),
    );

    expect(
      validateInPackage(defineContract({ name: 'orders-service', groups: [group] }), noOrigin),
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
        'method is a required string',
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
      standardRejections: { notFound },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
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

/** A Contract holding one declaration of each kind that has a `description`, the one named written as `text`. */
function contractWithDescription(kind: string, text: string) {
  const description = (own: string) => (own === kind ? text : 'Described');
  const guard = defineGuard({ name: 'quota', description: description('guard') });
  const endpoint = defineEndpoint({
    ...listing,
    description: description('endpoint'),
    guards: [guard],
  });
  const event = defineEvent({
    name: 'OrderCreated',
    version: 1,
    visibility: 'internal',
    description: description('event'),
    body: z.object({ orderId: z.uuid() }),
  });
  const command = defineCommand({
    name: 'ChargeCard',
    version: 1,
    description: description('command'),
    body: z.object({ orderId: z.uuid() }),
  });
  const subscription = defineSubscription({
    name: 'notifyOnCreated',
    description: description('subscription'),
    event,
  });
  const orders = defineGroup({
    name: 'orders',
    description: description('group'),
    endpoints: [endpoint],
    events: [event],
    commands: [command],
    subscriptions: [subscription],
  });
  return defineContract({ name: 'orders-service', groups: [orders] });
}

const blankTexts = ['', ' ', ' \t\n'];

describe('validateContract: a description or a message is never blank', () => {
  test('a Contract whose declarations are all described validates', () => {
    expect(validateInPackage(contractWithDescription('none', ''), noOrigin).kind).toBe('valid');
  });

  const described: readonly (readonly [string, readonly (string | number)[]])[] = [
    ['Endpoint', [...endpointAt, 'description']],
    ['Guard', ['guards', 'quota', 'description']],
    ['Group', ['groups', 'orders', 'description']],
    ['Event', ['groups', 'orders', 'events', 'OrderCreated@1', 'description']],
    ['Command', ['groups', 'orders', 'commands', 'ChargeCard@1', 'description']],
    ['Subscription', ['groups', 'orders', 'subscriptions', 'notifyOnCreated', 'description']],
  ];

  test.each(blankTexts.flatMap((text) => described.map(([kind, at]) => [kind, text, at] as const)))(
    '%s whose description is %j fails',
    (kind, text, at) => {
      const contract = contractWithDescription(kind.toLowerCase(), text);

      expect(validateInPackage(contract, noOrigin)).toEqual(
        failed(at, 'blank-text', 'A description is never blank'),
      );
    },
  );

  test.each(blankTexts)('a Rejection whose message is %j fails', (message) => {
    const rejection = defineRejection({ code: 'ORDER_LOCKED', status: 409, message });

    expect(validateEndpoint(defineEndpoint({ ...listing, rejections: [rejection] }))).toEqual(
      failed(['rejections', 'ORDER_LOCKED', 'message'], 'blank-text', 'A message is never blank'),
    );
  });

  test.each(blankTexts)('a Standard Rejection whose message is %j fails', (message) => {
    const definitions = defineDefinitions({
      standardRejections: { notFound: { code: 'NOT_FOUND', status: 404, message } },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(
        ['standardRejections', 'notFound', 'message'],
        'blank-text',
        'A message is never blank',
      ),
    );
  });
});
