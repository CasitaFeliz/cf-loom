import {
  defineCommand,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
} from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import type {
  Admission,
  CheckedOutcome,
  DirectMeta,
  EndpointCall,
  Fault,
  GuardCall,
  HandledBy,
  HandledRequest,
  HandlerMap,
  HandlerMapOf,
  InvalidCallError,
  InvalidOutcomeError,
  MessageFault,
  MessageMeta,
  NoResources,
  Outcome,
  Pairing,
  Readers,
  WithResources,
} from './index.ts';
import { admit, fault, handle, readersOf, reject, success } from './index.ts';

/** Every key any member of a union of records holds. */
type KeysOfEach<Record> = Record extends unknown ? keyof Record : never;

const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const rateLimited = defineRejection({
  code: 'RATE_LIMITED',
  status: 429,
  message: 'Slow down',
  headers: z.object({ 'x-retry-in': z.int().min(0) }),
  body: z.object({ limit: z.int() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The Caller holds every listed permission',
  guards: [apiKey],
  qualifier: z.array(z.string()),
  rejections: [rateLimited],
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey, { guard: permission, qualifier: ['orders:read'] }],
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ orderId: z.string() }) },
  rejections: [gone, orderLocked, rateLimited],
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.string() }),
});

const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: chargeCardV1.body } },
  subscriptions: {},
});

/** One of two values, typed as their union, as a variable whose type no literal narrows. */
function eitherOf<First, Second>(first: First, second: Second): First | Second {
  return Math.random() < 0.5 ? first : second;
}

const orders = defineService({
  name: 'orders-service',
  groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] })],
});

describe('the records a Service reads off a Handler', () => {
  test('a HandledBy brand holds a declaration and nothing else a Service can name', () => {
    expectTypeOf<Exclude<keyof HandledBy<Endpoint>, symbol>>().toEqualTypeOf<'declaration'>();
  });

  test('a Pairing holds a declaration and its Reader, and nothing else', () => {
    expectTypeOf<keyof Pairing>().toEqualTypeOf<'declaration' | 'reader'>();
  });

  test('a HandledRequest holds the signal and headers of the request, and no more', () => {
    expectTypeOf<keyof HandledRequest>().toEqualTypeOf<'signal' | 'headers'>();
  });

  test('a MessageMeta holds the Message’s ids, attempt, headers and signal, and no more', () => {
    expectTypeOf<keyof MessageMeta>().toEqualTypeOf<
      'messageId' | 'factId' | 'deliveryCount' | 'lastAttempt' | 'headers' | 'signal'
    >();
  });

  test('a DirectMeta holds each part of a MessageMeta, optional', () => {
    expectTypeOf<DirectMeta>().toEqualTypeOf<Partial<MessageMeta>>();
  });

  test('an EndpointCall holds the Context and the request, and no more', () => {
    expectTypeOf<keyof EndpointCall<typeof getOrder>>().toEqualTypeOf<'context' | 'request'>();
  });

  test('a GuardCall holds the Context and the request, and the Qualifier only of a Guard that declares one', () => {
    expectTypeOf<keyof GuardCall<typeof apiKey>>().toEqualTypeOf<'context' | 'request'>();
    expectTypeOf<keyof GuardCall<typeof permission>>().toEqualTypeOf<
      'context' | 'qualifier' | 'request'
    >();
  });

  test('WithResources hold the Resources, and no more', () => {
    expectTypeOf<keyof WithResources<{ readonly orders: string }>>().toEqualTypeOf<'resources'>();
  });

  test('NoResources hold no key', () => {
    expectTypeOf<keyof NoResources>().toBeNever();
  });

  test('an InvalidCallError holds the Issues, beside an Error’s own', () => {
    expectTypeOf<Exclude<keyof InvalidCallError, keyof Error>>().toEqualTypeOf<'issues'>();
  });

  test('an InvalidOutcomeError holds the Issues, beside an Error’s own', () => {
    expectTypeOf<Exclude<keyof InvalidOutcomeError, keyof Error>>().toEqualTypeOf<'issues'>();
  });
});

describe('the Handler map', () => {
  test('a HandlerMap holds the Endpoints, Guards, Commands, Subscriptions and Readers, and no more', () => {
    expectTypeOf<keyof HandlerMap>().toEqualTypeOf<
      'endpoints' | 'guards' | 'commands' | 'subscriptions' | 'readers'
    >();
  });

  test('a HandlerMapOf a Contract holds the same five, and no more', () => {
    expectTypeOf<keyof HandlerMapOf<typeof orders>>().toEqualTypeOf<
      'endpoints' | 'guards' | 'commands' | 'subscriptions' | 'readers'
    >();
  });

  test('Readers hold the Commands’ and the Subscriptions’ Readers, and no more', () => {
    expectTypeOf<keyof Readers>().toEqualTypeOf<'commands' | 'subscriptions'>();
  });
});

describe('what a Handler builds and a direct call returns', () => {
  test('a Fault holds its message, whether it committed and may be retried, and when and why, and no more', () => {
    expectTypeOf<KeysOfEach<Fault>>().toEqualTypeOf<
      'kind' | 'committed' | 'retryable' | 'retryAfter' | 'message' | 'cause'
    >();
  });

  test('a MessageFault holds the same six', () => {
    expectTypeOf<KeysOfEach<MessageFault>>().toEqualTypeOf<
      'kind' | 'committed' | 'retryable' | 'retryAfter' | 'message' | 'cause'
    >();
  });

  test('an Outcome holds a Success’s value, a Rejection’s declaration, headers and body, and a Fault’s keys, and no more', () => {
    expectTypeOf<KeysOfEach<Outcome<typeof getOrder>>>().toEqualTypeOf<
      | 'kind'
      | 'value'
      | 'rejection'
      | 'headers'
      | 'body'
      | 'committed'
      | 'retryable'
      | 'retryAfter'
      | 'message'
      | 'cause'
    >();
  });

  test('a CheckedOutcome holds the Success’s status where an Outcome holds its value, and no more', () => {
    expectTypeOf<KeysOfEach<CheckedOutcome<typeof getOrder>>>().toEqualTypeOf<
      | 'kind'
      | 'status'
      | 'body'
      | 'rejection'
      | 'headers'
      | 'committed'
      | 'retryable'
      | 'retryAfter'
      | 'message'
      | 'cause'
    >();
  });

  test('an Admission holds the admitted Context, a Rejection’s declaration, headers and body, and a Fault’s keys, and no more', () => {
    expectTypeOf<KeysOfEach<Admission<typeof permission>>>().toEqualTypeOf<
      | 'kind'
      | 'context'
      | 'rejection'
      | 'headers'
      | 'body'
      | 'committed'
      | 'retryable'
      | 'retryAfter'
      | 'message'
      | 'cause'
    >();
  });
});

describe('a Direct call and fault() refuse a field they do not declare, given through a variable too', () => {
  const getOrderHandler = handle(getOrder, () => success(getOrder, { orderId: 'o-1' }));
  const permissionHandler = handle(permission, () => admit(permission));
  const chargeCardHandler = handle(readers.commands.chargeCardV1, () => undefined);
  const input = { params: { orderId: 'o-1' } };
  const context = { apiKey: { callerId: 'c-1' } };

  test('fault given through a variable with a field it does not declare is a type error, a misspelled retryAfter included', () => {
    const misspelled = { committed: 'no', retryable: false, messge: 'Try another card' } as const;
    const late = { committed: 'no', retryable: true, retryAftr: 30 } as const;

    // @ts-expect-error TS2769 messge is not a declared field
    const building = () => fault(misspelled);
    // @ts-expect-error TS2769 retryAftr is not a declared field
    const buildingLate = () => fault(late);

    expect([building, buildingLate]).toHaveLength(2);
  });

  test('fault given a retryAfter and a misspelled field through a variable is a type error', () => {
    const given = { committed: 'no', retryable: true, retryAfter: 30, messge: 'Busy' } as const;

    // @ts-expect-error TS2769 messge is not a declared field
    const building = () => fault(given);

    expect(building).toBeTypeOf('function');
  });

  test('fault given a variable of a union type, one member holding a field it does not declare, is a type error', () => {
    const given = eitherOf(
      { committed: 'no', retryable: false, extra: 1 } as const,
      { committed: 'yes', retryable: false } as const,
    );

    // @ts-expect-error TS2769 extra is not a declared field
    const building = () => fault(given);

    expect(building).toBeTypeOf('function');
  });

  test('fault given a variable of a union type whose members hold only declared fields type-checks', () => {
    const given = eitherOf(
      { committed: 'no', retryable: false, message: 'Declined' } as const,
      { committed: 'yes', retryable: false } as const,
    );

    const built = fault(given);

    expect(built).toMatchObject({ kind: 'fault', retryable: false });
  });

  test('fault given through a variable with only declared fields type-checks, message and cause included', () => {
    const given = {
      committed: 'no',
      retryable: true,
      retryAfter: 30,
      message: 'Busy',
      cause: new Error('pool exhausted'),
    } as const;

    const built = fault(given);

    expect(built).toMatchObject({ retryable: true, retryAfter: 30, message: 'Busy' });
  });

  test('a Message Handler’s Direct call given meta through a variable with a field it does not declare is a type error', () => {
    const meta = { factId: 'o-1', delivryCount: 2 };

    // @ts-expect-error TS2345 delivryCount is not a declared field
    const calling = () => chargeCardHandler({ orderId: 'o-1' }, meta);

    expect(calling).toBeTypeOf('function');
  });

  test('an EndpointHandler’s Direct call given its second argument through a variable with a field it does not declare is a type error', () => {
    const call = { context, rquest: { signal: new AbortController().signal } };

    // @ts-expect-error TS2345 rquest is not a declared field
    const calling = () => getOrderHandler(input, call);

    expect(calling).toBeTypeOf('function');
  });

  test('a GuardHandler’s Direct call given its second argument through a variable with a field it does not declare is a type error', () => {
    const call = { context, qualifier: ['orders:read'], contxt: context };

    // @ts-expect-error TS2345 contxt is not a declared field
    const calling = () => permissionHandler({}, call);

    expect(calling).toBeTypeOf('function');
  });

  test('a Direct call’s request given through a variable with a field it does not declare is a type error, alone or inside the whole second argument', () => {
    const request = { signal: new AbortController().signal, headrs: new Headers() };
    const call = {
      context,
      request: { signal: new AbortController().signal, headrs: new Headers() },
    };

    // @ts-expect-error TS2322 headrs is not a declared field
    const callingWithRequest = () => getOrderHandler(input, { context, request });
    // @ts-expect-error TS2345 headrs is not a declared field
    const callingWithCall = () => getOrderHandler(input, call);

    expect([callingWithRequest, callingWithCall]).toHaveLength(2);
  });

  test('a GuardHandler’s Direct call given its request through a variable with a field it does not declare is a type error', () => {
    const request = { signal: new AbortController().signal, headrs: new Headers() };

    // @ts-expect-error TS2322 headrs is not a declared field
    const calling = () => permissionHandler({}, { context, qualifier: ['orders:read'], request });

    expect(calling).toBeTypeOf('function');
  });

  test('a GuardHandler’s Direct call given its last argument through a variable with a field beside resources is a type error', () => {
    const callersHandler = handle(
      permission,
      (_demands, _call, { resources }: WithResources<{ readonly callers: string }>) =>
        resources.callers === '' ? admit(permission) : admit(permission),
    );
    const last = { resources: { callers: 'c-1' }, resourcs: { callers: 'c-2' } };

    // @ts-expect-error TS2345 resourcs is not a declared field
    const calling = () => callersHandler({}, { context, qualifier: ['orders:read'] }, last);

    expect(calling).toBeTypeOf('function');
  });

  test('a Message Handler’s Direct call given its last argument through a variable with a field beside resources is a type error', () => {
    const chargingHandler = handle(
      readers.commands.chargeCardV1,
      (_body, _meta, { resources }: WithResources<{ readonly cards: string }>) =>
        resources.cards === '' ? undefined : undefined,
    );
    const last = { resources: { cards: 'k-1' }, resourcs: { cards: 'k-2' } };

    // @ts-expect-error TS2345 resourcs is not a declared field
    const calling = () => chargingHandler({ orderId: 'o-1' }, {}, last);

    expect(calling).toBeTypeOf('function');
  });

  test('a Direct call’s last argument given through a variable with a field beside resources is a type error', () => {
    const ordersHandler = handle(
      getOrder,
      (_input, _call, { resources }: WithResources<{ readonly orders: string }>) =>
        success(getOrder, { orderId: resources.orders }),
    );
    const last = { resources: { orders: 'o-1' }, resourcs: { orders: 'o-2' } };

    // @ts-expect-error TS2345 resourcs is not a declared field
    const calling = () => ordersHandler(input, { context }, last);

    expect(calling).toBeTypeOf('function');
  });

  test('a Direct call’s resources holding more keys than the Handler takes type-check', async () => {
    const ordersHandler = handle(
      getOrder,
      (_input, _call, { resources }: WithResources<{ readonly orders: string }>) =>
        success(getOrder, { orderId: resources.orders }),
    );
    const last = { resources: { orders: 'o-1', clock: () => 0 } };

    const outcome = await ordersHandler(input, { context }, last);

    expect(outcome).toMatchObject({ kind: 'success', body: { orderId: 'o-1' } });
  });
});

describe('success() and admit() take their declaration first, and check a literal against it', () => {
  const createOrder = defineEndpoint({
    name: 'createOrder',
    method: 'POST',
    path: '/orders',
    visibility: 'public',
    description: 'Places an order',
    guards: [apiKey],
    input: { body: z.object({ orderId: z.string() }) },
    success: {
      status: 201,
      headers: z.object({ location: z.string(), 'x-trace-id': z.string().optional() }),
      body: z.object({ orderId: z.string() }),
    },
  });
  const deleteOrder = defineEndpoint({
    name: 'deleteOrder',
    method: 'DELETE',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'Deletes an order',
    guards: [apiKey],
    input: { params: z.object({ orderId: z.string() }) },
    success: { status: 204 },
  });
  const input = { params: { orderId: 'o-1' } };
  const context = { apiKey: { callerId: 'c-1' } };

  test('a success literal with a field the Endpoint does not declare is a type error, in a sync and an async Handler', () => {
    const syncHandler = handle(getOrder, ({ params }) =>
      // @ts-expect-error TS2561 ordrId is not a declared field
      success(getOrder, { orderId: params.orderId, ordrId: params.orderId }),
    );
    const asyncHandler = handle(getOrder, async ({ params }) =>
      // @ts-expect-error TS2561 ordrId is not a declared field
      success(getOrder, { orderId: params.orderId, ordrId: params.orderId }),
    );

    expect([syncHandler, asyncHandler]).toHaveLength(2);
  });

  test('a misspelled optional header in a success literal is a type error', () => {
    const handler = handle(createOrder, ({ body }) =>
      success(createOrder, {
        // @ts-expect-error TS2353 x-trace-di is not a declared header
        headers: { location: `/orders/${body.orderId}`, 'x-trace-di': 't-1' },
        body,
      }),
    );

    expect(handler).toBeTypeOf('function');
  });

  test('a success given a variable that carries more fields than the body declares type-checks', async () => {
    const row = { orderId: 'o-1', passwordHash: 'h-1' };
    const handler = handle(getOrder, () => success(getOrder, row));

    const outcome = await handler(input, { context });

    expect(outcome).toEqual({ kind: 'success', status: 200, body: { orderId: 'o-1' } });
  });

  test('a Success built in a helper with no declared return type type-checks', async () => {
    const found = (orderId: string) =>
      orderId === 'o-1' ? success(getOrder, { orderId }) : reject(gone);
    const handler = handle(getOrder, ({ params }) => found(params.orderId));

    const outcome = await handler(input, { context });

    expect(outcome).toEqual({ kind: 'success', status: 200, body: { orderId: 'o-1' } });
  });

  test('a Success built into a variable before the return type-checks', async () => {
    const handler = handle(getOrder, ({ params }) => {
      const built = success(getOrder, { orderId: params.orderId });
      return built;
    });

    const outcome = await handler(input, { context });

    expect(outcome).toEqual({ kind: 'success', status: 200, body: { orderId: 'o-1' } });
  });

  test('success takes nothing more for an Endpoint that declares neither headers nor a body', async () => {
    const handler = handle(deleteOrder, () => success(deleteOrder));

    const outcome = await handler(input, { context });

    expect(outcome).toMatchObject({ kind: 'success', status: 204 });
  });

  test('success given a value for an Endpoint that declares neither headers nor a body is a type error', () => {
    const handler = handle(deleteOrder, ({ params }) =>
      // @ts-expect-error TS2554 a 204 without headers takes no value
      success(deleteOrder, { orderId: params.orderId }),
    );

    expect(handler).toBeTypeOf('function');
  });

  test('an admit literal with a field the Context does not declare is a type error', () => {
    const handler = handle(apiKey, () =>
      // @ts-expect-error TS2561 callrId is not a declared field
      admit(apiKey, { callerId: 'c-1', callrId: 'c-1' }),
    );

    expect(handler).toBeTypeOf('function');
  });

  test('admit given a variable that carries more fields than the Context declares type-checks', async () => {
    const caller = { callerId: 'c-1', plan: 'gold' };
    const handler = handle(apiKey, () => admit(apiKey, caller));

    const admission = await handler({ headers: { 'x-api-key': 'k-1' } }, {});

    expect(admission).toEqual({ kind: 'admitted', context: { callerId: 'c-1' } });
  });

  test('admit takes nothing more for a Guard that provides no Context', async () => {
    const handler = handle(permission, () => admit(permission));

    const admission = await handler({}, { context, qualifier: ['orders:read'] });

    expect(admission).toMatchObject({ kind: 'admitted' });
  });

  test('admit given a Context for a Guard that provides none is a type error', () => {
    const handler = handle(permission, () =>
      // @ts-expect-error TS2554 permission provides no Context
      admit(permission, { callerId: 'c-1' }),
    );

    expect(handler).toBeTypeOf('function');
  });
});

describe('readersOf refuses a field its table does not declare', () => {
  test('a table given through a variable with a field beside commands and subscriptions is a type error', () => {
    const table = { commands: {}, subscriptions: {}, subscriptons: {} };

    // @ts-expect-error TS2345 subscriptons is not a declared field
    const building = () => readersOf(table);

    expect(building).toBeTypeOf('function');
  });

  test('a table written as a literal with a field beside commands and subscriptions is a type error', () => {
    // @ts-expect-error TS2741 subscriptons is not a declared field
    const building = () => readersOf({ commands: {}, subscriptions: {}, subscriptons: {} });

    expect(building).toBeTypeOf('function');
  });
});
