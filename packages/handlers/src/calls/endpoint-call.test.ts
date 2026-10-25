import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  invalidInput,
  notFound,
  notImplemented,
} from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type Fault,
  fault,
  handle,
  InvalidInputError,
  InvalidOutcomeError,
  type Issue,
  isRejectionOf,
  type MessageFault,
  type ResolvedOutcome,
  reject,
  success,
  type WithResources,
} from '../index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});

const internalOnly = defineGuard({ name: 'internalOnly', description: 'Only the network' });

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey, internalOnly],
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ id: z.uuid(), total: z.int().min(0) }) },
  rejections: [notFound, orderLocked],
});

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'A new order',
  input: {
    headers: z.object({ 'x-request-id': z.string() }),
    body: z.object({
      email: z.email(),
      quantity: z.int().min(1).max(10).multipleOf(2),
      channel: z.enum(['web', 'phone']),
      note: z.string(),
      options: z.partialRecord(z.enum(['gift']), z.boolean()).optional(),
    }),
  },
  success: {
    status: 201,
    headers: z.object({ location: z.string().min(1) }),
    body: z.object({ id: z.uuid() }),
  },
});

const deleteOrder = defineEndpoint({
  name: 'deleteOrder',
  method: 'DELETE',
  path: '/orders/:orderId',
  visibility: 'internal',
  description: 'Deletes an order',
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 204 },
});

const orderTotal = defineEndpoint({
  name: 'orderTotal',
  method: 'GET',
  path: '/orders/:orderId/total',
  visibility: 'internal',
  description: 'The total of an order, in a header',
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 204, headers: z.object({ 'x-total': z.int() }) },
});

const validOrder = { email: 'a@b.co', quantity: 2, channel: 'web', note: 'none' } as const;
const { note: _note, ...withoutNote } = validOrder;
const createInput = { headers: { 'x-request-id': 'r-1' }, body: validOrder };
const getInput = { params: { orderId: ORDER_ID } };
const getContext = { apiKey: { callerId: 'c-1' } };

async function issuesOf(call: () => Promise<unknown>): Promise<readonly Issue[]> {
  try {
    await call();
  } catch (e) {
    if (e instanceof InvalidInputError || e instanceof InvalidOutcomeError) {
      return e.issues;
    }
    throw e;
  }
  throw new Error('the call did not throw');
}

const created = handle(createOrder, () =>
  success({ headers: { location: `/orders/${ORDER_ID}` }, body: { id: ORDER_ID } }),
);

describe('an EndpointHandler’s Resources', () => {
  type Orders = { readonly find: (orderId: string) => string | undefined };

  test('the implementation receives the Resources its direct call is given, and its Context without them', async () => {
    const resources = { orders: { find: () => 'order' } };
    const received: unknown[] = [];
    const getOrderHandler = handle(
      getOrder,
      (_input, context, call: WithResources<{ readonly orders: Orders }>) => {
        received.push(context, call.resources);
        return success({ id: ORDER_ID, total: 1 });
      },
    );

    await getOrderHandler(getInput, getContext, { resources });

    expect(received).toHaveLength(2);
    expect(received[0]).toStrictEqual(getContext);
    expect(received[1]).toBe(resources);
  });

  test('given the root and the Resources, a Standard Rejection resolves as serve resolves it', async () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'MISSING', status: 410, message: 'Gone' } },
    });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] })],
    });
    const orders: Orders = { find: () => undefined };
    const getOrderHandler = handle(
      getOrder,
      (input, _context, { resources }: WithResources<{ readonly orders: Orders }>) =>
        resources.orders.find(input.params.orderId) === undefined
          ? reject(notFound)
          : success({ id: ORDER_ID, total: 1 }),
    );

    const outcome = await getOrderHandler(getInput, getContext, {
      contract,
      resources: { orders },
    });

    expect(outcome).toMatchObject({ code: 'MISSING', status: 410, message: 'Gone' });
  });
});

describe('an EndpointHandler’s Input', () => {
  test('the implementation receives the parsed Input, unknown keys stripped, then the Context', async () => {
    const received: unknown[] = [];
    const getOrderHandler = handle(getOrder, (input, context) => {
      received.push(input, context);
      return success({ id: ORDER_ID, total: 1 });
    });

    await getOrderHandler({ params: { orderId: ORDER_ID, extra: 'x' } as never }, getContext);

    expect(received).toEqual([{ params: { orderId: ORDER_ID } }, getContext]);
  });

  test('Input that breaks a schema throws InvalidInputError with one Issue per failure', async () => {
    const issues = await issuesOf(() =>
      created({ headers: { 'x-request-id': 'r-1' }, body: { ...validOrder, email: 'nope' } }, {}),
    );

    expect(issues).toEqual([
      {
        part: 'input.body',
        path: ['email'],
        code: 'invalid_format',
        message: expect.any(String),
      },
    ]);
  });

  test('the error message names the Element, part, path and code, never the received value', async () => {
    const secret = 'the-secret-email';

    const call = created({ ...createInput, body: { ...validOrder, email: secret } }, {});

    await expect(call).rejects.toThrow(/^createOrder: input\.body\.email invalid_format: /);
    await expect(call).rejects.not.toThrow(secret);
  });

  test.each([
    ['required', withoutNote],
    ['invalid_type', { ...validOrder, note: undefined }],
    ['invalid_type', { ...validOrder, note: 7 }],
    ['invalid_value', { ...validOrder, channel: 'fax' }],
    ['invalid_format', { ...validOrder, email: 'nope' }],
    ['too_small', { ...validOrder, quantity: 0 }],
    ['too_big', { ...validOrder, quantity: 12 }],
    ['not_multiple', { ...validOrder, quantity: 3 }],
    ['unrecognized_key', { ...validOrder, options: { wrap: true } }],
  ])('a body that fails as %s gets that code', async (code, broken) => {
    const body = broken as never;

    const issues = await issuesOf(() => created({ ...createInput, body }, {}));

    expect(issues.map((issue) => issue.code)).toEqual([code]);
  });

  test('a part the Endpoint does not declare is not read', async () => {
    const received: unknown[] = [];
    const deleteOrderHandler = handle(deleteOrder, (input) => {
      received.push(input);
      return success();
    });

    await deleteOrderHandler({ ...getInput, body: 'anything' } as never, {});

    expect(received).toEqual([getInput]);
  });
});

describe('an EndpointHandler’s Context', () => {
  const getOrderHandler = handle(getOrder, () => success({ id: ORDER_ID, total: 1 }));

  test('a Context that breaks its Guard’s context schema throws', async () => {
    const issues = await issuesOf(() =>
      getOrderHandler(getInput, { apiKey: { callerId: 7 } } as never),
    );

    expect(issues).toEqual([
      {
        part: 'context',
        path: ['apiKey', 'callerId'],
        code: 'invalid_type',
        message: expect.any(String),
      },
    ]);
  });

  test('a missing Context throws', async () => {
    const issues = await issuesOf(() => getOrderHandler(getInput, {} as never));

    expect(issues).toEqual([
      { part: 'context', path: ['apiKey'], code: 'required', message: expect.any(String) },
    ]);
  });

  test('a Context key no attached Guard provides throws', async () => {
    const context = { ...getContext, internalOnly: {} } as never;

    const issues = await issuesOf(() => getOrderHandler(getInput, context));

    expect(issues).toEqual([
      {
        part: 'context',
        path: ['internalOnly'],
        code: 'unrecognized_key',
        message: expect.any(String),
      },
    ]);
  });
});

describe('an EndpointHandler’s Success', () => {
  test('success(body) resolves to the declared status and the parsed body', async () => {
    const getOrderHandler = handle(getOrder, () =>
      success({ id: ORDER_ID, total: 1, extra: true }),
    );

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toStrictEqual({
      kind: 'success',
      status: 200,
      body: { id: ORDER_ID, total: 1 },
    });
  });

  test('success({ headers, body }) carries both when the Endpoint declares headers', async () => {
    const outcome = await created(createInput, {});

    expect(outcome).toEqual({
      kind: 'success',
      status: 201,
      headers: { location: `/orders/${ORDER_ID}` },
      body: { id: ORDER_ID },
    });
  });

  test('success() resolves a 204 Endpoint', async () => {
    const deleteOrderHandler = handle(deleteOrder, () => success());

    const outcome = await deleteOrderHandler(getInput, {});

    expect(outcome).toEqual({ kind: 'success', status: 204 });
  });

  test('success({ headers }) resolves a 204 Endpoint with headers', async () => {
    const orderTotalHandler = handle(orderTotal, () => success({ headers: { 'x-total': 3 } }));

    const outcome = await orderTotalHandler(getInput, {});

    expect(outcome).toEqual({ kind: 'success', status: 204, headers: { 'x-total': 3 } });
  });

  test('a Success body that breaks a constraint throws InvalidOutcomeError', async () => {
    const getOrderHandler = handle(getOrder, () => success({ id: ORDER_ID, total: -1 }));

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues).toEqual([
      { part: 'success.body', path: ['total'], code: 'too_small', message: expect.any(String) },
    ]);
  });

  test('Success headers that break their schema throw InvalidOutcomeError', async () => {
    const createOrderHandler = handle(createOrder, () =>
      success({ headers: { location: '' }, body: { id: ORDER_ID } }),
    );

    const issues = await issuesOf(() => createOrderHandler(createInput, {}));

    expect(issues).toEqual([
      {
        part: 'success.headers',
        path: ['location'],
        code: 'too_small',
        message: expect.any(String),
      },
    ]);
  });

  test.each([
    ['above U+00FF', 'v€'],
    ['with a line feed', 'v\n1'],
    ['with a carriage return', 'v\r1'],
    ['with a NUL', 'v\u00001'],
    ['with U+0100', 'vĀ'],
    ['with a control character', 'v\u0001'],
    ['with DEL', 'v\u007f'],
    ['with a leading space', ' v1'],
    ['with a trailing tab', 'v1\t'],
  ])(
    'a Success header value %s cannot travel, so the direct call throws InvalidOutcomeError at success.headers',
    async (_case, location) => {
      const createOrderHandler = handle(createOrder, () =>
        success({ headers: { location }, body: { id: ORDER_ID } }),
      );

      const issues = await issuesOf(() => createOrderHandler(createInput, {}));

      expect(issues).toEqual([
        {
          part: 'success.headers',
          path: ['location'],
          code: 'invalid_format',
          message: expect.any(String),
        },
      ]);
    },
  );

  test('a header value with a tab inside, or U+00FF, is returned as given', async () => {
    const createOrderHandler = handle(createOrder, () =>
      success({ headers: { location: 'v\tÿ' }, body: { id: ORDER_ID } }),
    );

    const outcome = await createOrderHandler(createInput, {});

    expect(outcome).toEqual({
      kind: 'success',
      status: 201,
      headers: { location: 'v\tÿ' },
      body: { id: ORDER_ID },
    });
  });

  test('an undeclared Success header that cannot travel is dropped, never checked', async () => {
    const given = { location: '/o/1', 'x-extra': 'a\nb' };
    const createOrderHandler = handle(createOrder, () =>
      success({ headers: given, body: { id: ORDER_ID } }),
    );

    const outcome = await createOrderHandler(createInput, {});

    expect(outcome).toStrictEqual({
      kind: 'success',
      status: 201,
      headers: { location: '/o/1' },
      body: { id: ORDER_ID },
    });
  });

  test('a body given to a 204 throws InvalidOutcomeError', async () => {
    const deleteOrderHandler = handle(deleteOrder, () => success({ id: ORDER_ID }) as never);

    const issues = await issuesOf(() => deleteOrderHandler(getInput, {}));

    expect(issues.map(({ part, path }) => ({ part, path }))).toEqual([
      { part: 'success.body', path: [] },
    ]);
  });

  test('a Success of the wrong shape is a type error', () => {
    const write = () =>
      // @ts-expect-error total is a number
      handle(getOrder, () => success({ id: ORDER_ID, total: 'one' }));

    expect(write).not.toThrow();
  });
});

describe('an EndpointHandler’s Rejections', () => {
  test('reject(notFound) resolves against cf-loom’s defaults and is told by its declaration', async () => {
    const getOrderHandler = handle(getOrder, () => reject(notFound));

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toStrictEqual({
      kind: 'rejection',
      rejection: notFound,
      code: 'NOT_FOUND',
      status: 404,
      message: 'Not found',
    });
    expect(isRejectionOf(outcome, notFound)).toBe(true);
  });

  test('given the root, a Standard Rejection resolves to the listed Definitions Package’s', async () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'MISSING', status: 410, message: 'Gone' } },
    });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] })],
    });
    const getOrderHandler = handle(getOrder, () => reject(notFound));

    const outcome = await getOrderHandler(getInput, getContext, { contract });

    expect(outcome).toMatchObject({ code: 'MISSING', status: 410, message: 'Gone' });
  });

  test('reject(orderLocked, body) carries the declaration, the parsed body and the declared code', async () => {
    const lockedAt = '2026-10-18T10:00:00Z';
    const getOrderHandler = handle(getOrder, () => reject(orderLocked, { lockedAt }));

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toEqual({
      kind: 'rejection',
      rejection: orderLocked,
      body: { lockedAt },
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'The order can no longer be changed',
    });
  });

  test('a Guard’s Rejection is one the Endpoint answers', async () => {
    const getOrderHandler = handle(getOrder, () => reject(unauthenticated));

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toMatchObject({ kind: 'rejection', code: 'UNAUTHENTICATED', status: 401 });
  });

  test('a Rejection body that breaks its schema throws InvalidOutcomeError', async () => {
    const getOrderHandler = handle(getOrder, () => reject(orderLocked, { lockedAt: 'soon' }));

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues).toEqual([
      { part: 'body', path: ['lockedAt'], code: 'invalid_format', message: expect.any(String) },
    ]);
  });

  test('a missing Rejection body throws InvalidOutcomeError', async () => {
    const getOrderHandler = handle(getOrder, () => reject(orderLocked as never));

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues.map(({ part, code }) => ({ part, code }))).toEqual([
      { part: 'body', code: 'required' },
    ]);
  });

  test('a body for a Rejection without one throws InvalidOutcomeError', async () => {
    const getOrderHandler = handle(getOrder, () =>
      Reflect.apply(reject, undefined, [notFound, { id: ORDER_ID }]),
    );

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues.map(({ part, path }) => ({ part, path }))).toEqual([{ part: 'body', path: [] }]);
  });

  test('a Rejection the Endpoint does not answer throws InvalidOutcomeError', async () => {
    const getOrderHandler = handle(getOrder, () => reject(forbidden) as never);

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues).toEqual([
      {
        part: 'rejections',
        path: [],
        code: 'invalid_value',
        message: 'FORBIDDEN is not a Rejection getOrder answers',
      },
    ]);
  });

  test('a Rejection body comes back parsed, an unknown key stripped', async () => {
    const lockedAt = '2026-10-18T10:00:00Z';
    const body = { lockedAt, by: 'someone' };
    const getOrderHandler = handle(getOrder, () => reject(orderLocked, body));

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toMatchObject({ kind: 'rejection', body: { lockedAt } });
    expect(isRejectionOf(outcome, orderLocked) && outcome.body).toEqual({ lockedAt });
  });

  test('the invalid-input Rejection is the runtime’s, never a Handler’s', async () => {
    const getOrderHandler = handle(getOrder, () => reject(invalidInput as never));

    const call = getOrderHandler(getInput, getContext);

    await expect(call).rejects.toThrow(InvalidOutcomeError);
  });

  test('a Rejection the Endpoint does not list, invalidInput and a missing body are type errors', () => {
    const write = () => [
      // @ts-expect-error forbidden is not a Rejection getOrder answers
      handle(getOrder, () => reject(forbidden)),
      // @ts-expect-error the runtime answers invalid input
      handle(getOrder, () => reject(invalidInput)),
      // @ts-expect-error orderLocked declares a body
      handle(getOrder, () => reject(orderLocked)),
    ];

    expect(write).not.toThrow();
  });
});

describe('an EndpointHandler’s Faults', () => {
  test('an implementation that throws answers the Fault Internal error, the error as cause', async () => {
    const error = new Error('database down');
    const getOrderHandler = handle(getOrder, () => {
      throw error;
    });

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toEqual({
      kind: 'fault',
      committed: 'unknown',
      retryable: false,
      message: 'Internal error',
      cause: error,
    });
  });

  test('a Fault the implementation returns is answered as built, its message Internal error', async () => {
    const getOrderHandler = handle(getOrder, async () =>
      fault({ committed: 'no', retryable: true }),
    );

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toEqual({
      kind: 'fault',
      committed: 'no',
      retryable: true,
      message: 'Internal error',
    });
  });
});

describe('fault() retryAfter', () => {
  test('retryAfter is given only to a retryable Fault', () => {
    const later = fault({ committed: 'no', retryable: true, retryAfter: 5 });

    expectTypeOf(later.retryAfter).toEqualTypeOf<number>();
    // @ts-expect-error a Fault not worth retrying says no time to retry
    expect(() => fault({ committed: 'no', retryable: false, retryAfter: 5 })).toThrow(
      'fault(): retryAfter is given only to a retryable Fault',
    );
  });

  test.each([
    [1.5, '1.5'],
    [-1, '-1'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['5', '"5"'],
  ])('fault() refuses a retryAfter of %s, naming it', (retryAfter, named) => {
    const building = () =>
      fault({ committed: 'no', retryable: true, retryAfter: retryAfter as number });

    expect(building).toThrow(
      `fault(): retryAfter is no whole number of seconds from 0: got ${named}`,
    );
  });

  test('the Fault type gives retryAfter to a retryable Fault only', () => {
    const given = { committed: 'no', retryable: false, retryAfter: 5 } as const;
    const retryable: boolean = given.retryable;
    const built: Fault = { kind: 'fault', committed: 'no', retryable, message: 'm' };
    const plain: MessageFault = fault({ committed: 'no', retryable });

    // @ts-expect-error a spread cannot make a Fault that says when to retry not retryable
    const spread: Fault = {
      ...fault({ committed: 'no', retryable: true, retryAfter: 5 }),
      retryable: false,
    };
    // @ts-expect-error a Fault built by hand that is not retryable takes no retryAfter
    const byHand: Fault = {
      kind: 'fault',
      committed: 'no',
      retryable: false,
      message: 'm',
      retryAfter: 5,
    };
    // @ts-expect-error fault() refuses retryAfter on a Fault that is not retryable, given as a value
    const fromValue = () => fault(given);

    expectTypeOf<Extract<Fault, { retryable: false }>['retryAfter']>().toEqualTypeOf<undefined>();
    expectTypeOf<Fault['retryAfter']>().toEqualTypeOf<number | undefined>();
    expect([built.retryable, plain.retryable, spread.retryable, byHand.retryAfter]).toEqual([
      false,
      false,
      false,
      5,
    ]);
    expect(fromValue).toThrow('fault(): retryAfter is given only to a retryable Fault');
  });

  test('a Fault built by hand whose retryAfter cannot be sent is an invalid Outcome', async () => {
    const getOrderHandler = handle(
      getOrder,
      () =>
        ({
          kind: 'fault',
          committed: 'no',
          retryable: false,
          message: 'Down',
          retryAfter: 5,
        }) as never,
    );

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues).toEqual([
      {
        part: 'fault',
        path: ['retryAfter'],
        code: 'invalid_value',
        message: 'retryAfter is given only to a retryable Fault',
      },
    ]);
  });
});

describe('what an EndpointHandler returns', () => {
  test('a body on a headers-only Success throws InvalidOutcomeError', async () => {
    const orderTotalHandler = handle(
      orderTotal,
      () => success({ headers: { 'x-total': 3 }, body: { id: ORDER_ID } }) as never,
    );

    const issues = await issuesOf(() => orderTotalHandler(getInput, {}));

    expect(issues).toEqual([
      { part: 'success.body', path: [], code: 'invalid_type', message: 'Expected no value' },
    ]);
  });

  test('a body on a headers-only Success is a type error', () => {
    const write = () => [
      // @ts-expect-error a headers-only Success has no body
      handle(orderTotal, () => success({ headers: { 'x-total': 3 }, body: { id: ORDER_ID } })),
      // @ts-expect-error a 204 Success has no body
      handle(deleteOrder, () => success({ id: ORDER_ID })),
    ];

    expect(write).not.toThrow();
  });

  test('the parsed Context reaches the implementation, unknown keys stripped', async () => {
    const received: unknown[] = [];
    const getOrderHandler = handle(getOrder, (_input, context) => {
      received.push(context);
      return reject(notFound);
    });

    await getOrderHandler(getInput, { apiKey: { callerId: 'c-1', extra: true } } as never);

    expect(received).toEqual([getContext]);
  });

  test('fault() given an undefined message says Internal error and has no cause', () => {
    const built = fault({ committed: 'no', retryable: true, message: undefined, cause: undefined });

    expect(built).toStrictEqual({
      kind: 'fault',
      committed: 'no',
      retryable: true,
      message: 'Internal error',
    });
  });

  test('a returned Fault with its own message and cause comes back with both', async () => {
    const cause = new Error('replica lagging');
    const getOrderHandler = handle(getOrder, () =>
      fault({ committed: 'no', retryable: true, message: 'Try again', cause }),
    );

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toEqual({
      kind: 'fault',
      committed: 'no',
      retryable: true,
      message: 'Try again',
      cause,
    });
  });

  test.each([
    ['a hand-built Fault without its fields', { kind: 'fault' }, 'the kind fault'],
    ['null', null, 'null'],
  ])('%s is no Outcome and answers the Fault Internal error', async (_name, returned, what) => {
    const getOrderHandler = handle(getOrder, () => returned as never);

    const outcome = await getOrderHandler(getInput, getContext);

    expect(outcome).toEqual({
      kind: 'fault',
      committed: 'unknown',
      retryable: false,
      message: 'Internal error',
      cause: new TypeError(`getOrder's Handler returned no Outcome but ${what}`),
    });
  });
});

describe('more of what a direct call answers', () => {
  test('success({ headers }) resolves a 204 Endpoint with headers', async () => {
    const touchOrder = defineEndpoint({
      name: 'touchOrder',
      method: 'POST',
      path: '/orders/:orderId/touch',
      visibility: 'internal',
      description: 'Marks an order as seen',
      input: { params: z.object({ orderId: z.uuid() }) },
      success: { status: 204, headers: z.object({ etag: z.string() }) },
    });
    const touchOrderHandler = handle(touchOrder, () => success({ headers: { etag: 'v2' } }));

    const outcome = await touchOrderHandler(getInput, {});

    expect(outcome).toStrictEqual({ kind: 'success', status: 204, headers: { etag: 'v2' } });
  });

  test('a class instance missing a key of the Success body throws required', async () => {
    class Row {
      readonly id = ORDER_ID;
    }
    const getOrderHandler = handle(getOrder, () => success(new Row() as never));

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: ['total'], code: 'required' },
    ]);
  });

  test('an error carries one Issue per failure and one line per Issue', async () => {
    const body = { ...validOrder, email: 'nope', quantity: 0 };

    const caught = await created({ ...createInput, body }, {}).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(caught).toBeInstanceOf(InvalidInputError);
    const error = caught as InvalidInputError;
    expect(error.issues.map(({ path }) => path)).toEqual([['email'], ['quantity']]);
    expect(error.message.split('\n')).toEqual([
      expect.stringMatching(/^createOrder: input\.body\.email invalid_format: /),
      expect.stringMatching(/^createOrder: input\.body\.quantity too_small: /),
    ]);
  });

  test('something that is no Rejection, rejected, throws InvalidOutcomeError', async () => {
    const getOrderHandler = handle(getOrder, () => reject(undefined as never));

    const issues = await issuesOf(() => getOrderHandler(getInput, getContext));

    expect(issues.map(({ message }) => message)).toEqual([
      'A value that is no Rejection is not a Rejection getOrder answers',
    ]);
  });
});

describe('a Standard Rejection from another copy of @cf-loom/contract', () => {
  test('the not-implemented Rejection of the contract source resolves', async () => {
    const sourceUrl = new URL('../../../contract/src/index.ts', import.meta.url).href;
    const source: { readonly notImplemented: unknown } = await import(sourceUrl);
    const getOrderHandler = handle(getOrder, () => reject(source.notImplemented as never));

    const outcome = await getOrderHandler(getInput, getContext);

    expect(source.notImplemented).not.toBe(notImplemented);
    expect(outcome).toMatchObject({ kind: 'rejection', code: 'NOT_IMPLEMENTED', status: 501 });
  });
});

describe('an EndpointHandler stub', () => {
  const stub = handle.stub(getOrder);

  test('a stub answers the not-implemented Rejection, resolved', async () => {
    const outcome = await stub(getInput, getContext);

    expect(outcome).toEqual({
      kind: 'rejection',
      rejection: notImplemented,
      code: 'NOT_IMPLEMENTED',
      status: 501,
      message: 'Not implemented',
    });
  });

  test('a stub still throws on Input that breaks the Contract', async () => {
    const call = stub({ params: { orderId: 'nope' } }, getContext);

    await expect(call).rejects.toThrow(InvalidInputError);
  });

  test('a direct call’s Outcome includes the not-implemented Rejection', () => {
    type Rejected = Extract<ResolvedOutcome<typeof getOrder>, { kind: 'rejection' }>;

    expectTypeOf<Rejected['rejection']>().toEqualTypeOf<
      typeof notFound | typeof orderLocked | typeof unauthenticated | typeof notImplemented
    >();
  });
});
