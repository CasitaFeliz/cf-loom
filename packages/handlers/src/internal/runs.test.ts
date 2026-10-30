import {
  defineCommand,
  defineEndpoint,
  defineEvent,
  defineGuard,
  defineSubscription,
  notFound,
  notImplemented,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { admit, fault, handle, readersOf, reject, success } from '../index.ts';
import {
  checkedMessageBody,
  faultLineOf,
  faultLogOf,
  isStub,
  logOf,
  mappedHandlerOf,
  runEndpoint,
  runGuard,
  runMessage,
  writtenMessageBody,
} from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const request = { signal: new AbortController().signal, headers: new Headers() };

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The Caller holds a permission',
  guards: [apiKey],
  qualifier: z.enum(['orders:read']),
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey],
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ id: z.uuid() }) },
  rejections: [notFound],
});

const getContext = { apiKey: { callerId: 'c-1' } };

const orderBody = z.object({ orderId: z.uuid() });

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

const orderPaidV1 = defineEvent({
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: orderBody,
});

const notifyOnPaidV1 = defineSubscription({
  name: 'notifyOnPaid',
  description: 'Notify on paid',
  event: orderPaidV1,
});

const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: orderBody } },
  subscriptions: { notifyOnPaid: { declaration: notifyOnPaidV1, reader: orderBody } },
});

const chargeCard = readers.commands.chargeCardV1;
const notifyOnPaid = readers.subscriptions.notifyOnPaid;

describe('runEndpoint', () => {
  const getOrderHandler = handle(getOrder, () => reject(notFound));

  test('runEndpoint hands the implementation the very Input it is given, never parsed again', async () => {
    const received: unknown[] = [];
    const inspecting = handle(getOrder, ({ params }) => {
      received.push(params);
      return reject(notFound);
    });
    const params = { orderId: ORDER_ID };
    const call = { input: { params }, context: getContext, request, resources: undefined };

    await runEndpoint(inspecting, call);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(params);
  });

  test('an Outcome that breaks the Contract is invalid-outcome with its issues', async () => {
    const brokenHandler = handle(getOrder, () => success(getOrder, { id: 'nope' }));
    const call = {
      input: { params: { orderId: ORDER_ID } },
      context: getContext,
      request,
      resources: undefined,
    };

    const run = await runEndpoint(brokenHandler, call);

    expect(run).toMatchObject({ kind: 'invalid-outcome', issues: [{ part: 'success.body' }] });
  });

  test('an answer is the checked Outcome, a Standard Rejection as built', async () => {
    const call = {
      input: { params: { orderId: ORDER_ID } },
      context: getContext,
      request,
      resources: undefined,
    };

    const run = await runEndpoint(getOrderHandler, call);

    expect(run).toEqual({
      kind: 'answered',
      answer: { kind: 'rejection', rejection: notFound },
    });
  });
});

describe('runGuard', () => {
  test('runGuard hands the implementation the very demands it is given, never parsed again', async () => {
    const received: unknown[] = [];
    const inspecting = handle(apiKey, ({ headers }) => {
      received.push(headers);
      return admit(apiKey, { callerId: 'c-1' });
    });
    const headers = { 'x-api-key': 'k' };
    const call = {
      demands: { headers },
      context: {},
      qualifier: undefined,
      request,
      resources: undefined,
    };

    await runGuard(inspecting, call);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(headers);
  });

  test('an admitted Context that breaks the Contract is invalid-outcome', async () => {
    const apiKeyHandler = handle(apiKey, () => admit(apiKey, { callerId: 7 } as never));
    const call = {
      demands: { headers: { 'x-api-key': 'k' } },
      context: {},
      qualifier: undefined,
      request,
      resources: undefined,
    };

    const run = await runGuard(apiKeyHandler, call);

    expect(run).toMatchObject({ kind: 'invalid-outcome', issues: [{ part: 'context' }] });
  });

  test('an answer is the checked Admission, a stub’s Rejection as built', async () => {
    const call = {
      demands: { headers: { 'x-api-key': 'k' } },
      context: {},
      qualifier: undefined,
      request,
      resources: undefined,
    };

    const run = await runGuard(handle.stub(apiKey), call);

    expect(run).toStrictEqual({
      kind: 'answered',
      answer: { kind: 'rejection', rejection: notImplemented },
    });
  });
});

describe('a run given the Context and Qualifier serve built', () => {
  const permissionHandler = handle(permission, () => admit(permission));
  const getOrderHandler = handle(getOrder, () => reject(notFound));
  const brokenContext = { apiKey: {} };

  test('a Context that breaks the Contract is invalid-call at context, in runEndpoint and runGuard', async () => {
    const endpointCall = {
      input: { params: { orderId: ORDER_ID } },
      context: brokenContext,
      request,
      resources: undefined,
    };
    const guardCall = {
      demands: {},
      context: brokenContext,
      qualifier: 'orders:read',
      request,
      resources: undefined,
    };

    const runs = [
      await runEndpoint(getOrderHandler, endpointCall),
      await runGuard(permissionHandler, guardCall),
    ];

    const atContext = {
      kind: 'invalid-call',
      issues: [{ part: 'context', path: ['apiKey', 'callerId'] }],
    };
    expect(runs).toMatchObject([atContext, atContext]);
  });

  test('a Qualifier that breaks its Guard’s schema is invalid-call at qualifier in runGuard', async () => {
    const call = {
      demands: {},
      context: getContext,
      qualifier: 'orders:delete',
      request,
      resources: undefined,
    };

    const run = await runGuard(permissionHandler, call);

    expect(run).toMatchObject({
      kind: 'invalid-call',
      issues: [{ part: 'qualifier', code: 'invalid_value' }],
    });
  });

  test('a Context and a Qualifier that both break the Contract are listed in that order in runGuard', async () => {
    const call = {
      demands: {},
      context: brokenContext,
      qualifier: 'orders:delete',
      request,
      resources: undefined,
    };

    const run = await runGuard(permissionHandler, call);

    expect(run).toMatchObject({
      kind: 'invalid-call',
      issues: [
        { part: 'context', path: ['apiKey', 'callerId'] },
        { part: 'qualifier', code: 'invalid_value' },
      ],
    });
  });

  test('each Handler run gets its own parsed Context, not the object it was given', async () => {
    const received: unknown[] = [];
    const readingEndpoint = handle(getOrder, (_input, { context }) => {
      received.push(context.apiKey);
      return reject(notFound);
    });
    const readingGuard = handle(permission, (_demands, { context }) => {
      received.push(context.apiKey);
      return admit(permission);
    });
    const context = { apiKey: { callerId: 'c-1' } };
    const endpointCall = {
      input: { params: { orderId: ORDER_ID } },
      context,
      request,
      resources: undefined,
    };
    const guardCall = {
      demands: {},
      context,
      qualifier: 'orders:read',
      request,
      resources: undefined,
    };

    await runEndpoint(readingEndpoint, endpointCall);
    await runGuard(readingGuard, guardCall);

    expect(received).toStrictEqual([context.apiKey, context.apiKey]);
    expect(new Set([context.apiKey, ...received]).size).toBe(3);
  });
});

describe('a run of a Handler that throws or returns no Outcome', () => {
  test('a throw is thrown, its Fault carrying the error, never answered', async () => {
    const error = new Error('database down');
    const getOrderHandler = handle(getOrder, () => {
      throw error;
    });
    const call = {
      input: { params: { orderId: ORDER_ID } },
      context: getContext,
      request,
      resources: undefined,
    };

    const run = await runEndpoint(getOrderHandler, call);

    expect(run).toEqual({
      kind: 'thrown',
      fault: {
        kind: 'fault',
        committed: 'unknown',
        retryable: false,
        message: 'Internal error',
        cause: error,
      },
    });
  });

  test('a Guard returning success(endpoint) is thrown, not a throw of the run', async () => {
    const apiKeyHandler = handle(apiKey, () => success(getOrder, { id: ORDER_ID }) as never);
    const call = {
      demands: { headers: { 'x-api-key': 'k' } },
      context: {},
      qualifier: undefined,
      request,
      resources: undefined,
    };

    const run = await runGuard(apiKeyHandler, call);

    expect(run).toMatchObject({
      kind: 'thrown',
      fault: {
        cause: new TypeError("apiKey's Handler returned no Admission but the kind success"),
      },
    });
  });

  test('a Fault the Handler returns is answered', async () => {
    const getOrderHandler = handle(getOrder, () => fault({ committed: 'no', retryable: true }));
    const call = {
      input: { params: { orderId: ORDER_ID } },
      context: getContext,
      request,
      resources: undefined,
    };

    const run = await runEndpoint(getOrderHandler, call);

    expect(run).toMatchObject({ kind: 'answered', answer: { kind: 'fault', committed: 'no' } });
  });
});

describe('what a run tells to be no Outcome', () => {
  const endpointCall = {
    input: { params: { orderId: ORDER_ID } },
    context: getContext,
    request,
    resources: undefined,
  };
  const guardCall = {
    demands: { headers: { 'x-api-key': 'k' } },
    context: {},
    qualifier: undefined,
    request,
    resources: undefined,
  };
  const fields = { committed: 'no', retryable: true, message: 'Try again' };

  test.each([
    ['a Fault with a bad committed', { kind: 'fault', ...fields, committed: 'maybe' }],
    ['a Fault with a bad retryable', { kind: 'fault', ...fields, retryable: 'yes' }],
    ['a Fault with a bad message', { kind: 'fault', ...fields, message: 7 }],
    ['a Success without its value', { kind: 'success' }],
    ['a Rejection without its declaration', { kind: 'rejection' }],
  ])('an EndpointHandler returning %s is thrown', async (_name, returned) => {
    const getOrderHandler = handle(getOrder, () => returned as never);

    const run = await runEndpoint(getOrderHandler, endpointCall);

    expect(run.kind).toBe('thrown');
  });

  test('a GuardHandler returning an admission without its Context is thrown', async () => {
    const apiKeyHandler = handle(apiKey, () => ({ kind: 'admitted' }) as never);

    const run = await runGuard(apiKeyHandler, guardCall);

    expect(run.kind).toBe('thrown');
  });

  test('a Fault a GuardHandler returns is answered', async () => {
    const apiKeyHandler = handle(apiKey, () => fault({ committed: 'no', retryable: true }));

    const run = await runGuard(apiKeyHandler, guardCall);

    expect(run).toMatchObject({ kind: 'answered', answer: { kind: 'fault', committed: 'no' } });
  });
});

describe('a Handler of another kind', () => {
  test('runGuard given an EndpointHandler throws Not a Handler', () => {
    const getOrderHandler = handle(getOrder, () => reject(notFound));
    const call = { demands: {}, context: {}, qualifier: undefined, request, resources: undefined };

    const run = () => runGuard(getOrderHandler as never, call);

    expect(run).toThrow('Not a Handler');
  });
});

describe('isStub', () => {
  test('a stub is told from a written Handler', () => {
    const written = handle(getOrder, () => reject(notFound));
    const stub = handle.stub(getOrder);

    const stubs = [isStub(written), isStub(stub)];

    expect(stubs).toEqual([false, true]);
  });

  test('isStub tells a Message Handler stub from a written one', () => {
    const handlers = [
      handle(chargeCard, () => undefined),
      handle.stub(chargeCard),
      handle(notifyOnPaid, () => undefined),
      handle.stub(notifyOnPaid),
    ];

    const stubs = handlers.map(isStub);

    expect(stubs).toEqual([false, true, false, true]);
  });
});

describe('mappedHandlerOf, by the declaration a Handler was written for', () => {
  test('a Handler is found for its own declaration, not another, and a plain function never', () => {
    const getOrderHandler = handle(getOrder, () => reject(notFound));
    const apiKeyHandler = handle(apiKey, () => admit(apiKey, { callerId: 'c-1' }));
    const lookalike = Object.assign(() => undefined, { declaration: getOrder });

    const written = [
      isFoundFor(getOrderHandler, getOrder),
      isFoundFor(apiKeyHandler, apiKey),
      isFoundFor(getOrderHandler, apiKey),
      isFoundFor(handle.stub(permission), apiKey),
      isFoundFor(lookalike, getOrder),
      isFoundFor(undefined, getOrder),
    ];

    expect(written).toEqual([true, true, false, false, false, false]);
  });

  test('a Message Handler is found for its own Command or Subscription, never another', () => {
    const chargeCardHandler = handle(chargeCard, () => undefined);
    const notifyOnPaidHandler = handle.stub(notifyOnPaid);

    const written = [
      isFoundFor(chargeCardHandler, chargeCardV1),
      isFoundFor(notifyOnPaidHandler, notifyOnPaidV1),
      isFoundFor(chargeCardHandler, notifyOnPaidV1),
      isFoundFor(notifyOnPaidHandler, orderPaidV1 as never),
      isFoundFor(chargeCard, chargeCardV1),
    ];

    expect(written).toEqual([true, true, false, false, false]);
  });
});

describe('runMessage', () => {
  const statuses = ['pending', 'paid'] as const;
  const shippedV1 = defineCommand({
    name: 'Ship',
    version: 1,
    description: 'Ships the order',
    body: z.object({ orderId: z.uuid(), status: openEnum(statuses) }),
  });
  const shipping = readersOf({
    commands: {
      shipV1: {
        declaration: shippedV1,
        reader: z.object({ orderId: z.uuid(), status: openEnumReader(statuses) }),
      },
    },
    subscriptions: {},
  }).commands.shipV1;
  const meta = {
    messageId: 'command.Ship.v1:o-1',
    factId: 'o-1',
    deliveryCount: 1,
    lastAttempt: false,
    headers: {},
    signal: new AbortController().signal,
  };

  test('runMessage reads a received body with its Reader, without writing it back', async () => {
    const received: unknown[] = [];
    const shipHandler = handle(shipping, (body) => {
      received.push(body);
    });

    const run = await runMessage(shipHandler, {
      body: { orderId: ORDER_ID, status: 'refunded', extra: 'dropped' },
      meta,
      resources: undefined,
    });

    expect(run).toEqual({ kind: 'answered', answer: undefined });
    expect(received).toEqual([{ orderId: ORDER_ID, status: { unknown: 'refunded' } }]);
  });

  test('runMessage given a value handle() did not return throws', () => {
    const lookalike = Object.assign(() => undefined, { declaration: chargeCardV1 });

    const run = () => runMessage(lookalike, { body: {}, meta, resources: undefined });

    expect(run).toThrow('Not a Handler');
  });
});

describe('a run given a value nested past the stack', () => {
  const tree: z.ZodType = z.object({
    get next() {
      return tree.optional();
    },
  });
  const nestV1 = defineCommand({
    name: 'Nest',
    version: 1,
    description: 'A deep body',
    body: tree,
  });
  const nesting = readersOf({
    commands: { nestV1: { declaration: nestV1, reader: tree } },
    subscriptions: {},
  }).commands.nestV1;
  const meta = {
    messageId: 'command.Nest.v1:o-1',
    factId: 'o-1',
    deliveryCount: 1,
    lastAttempt: false,
    headers: {},
    signal: new AbortController().signal,
  };

  function nestedTo(depth: number): object {
    let body: object = {};
    for (let level = 0; level < depth; level += 1) {
      body = { next: body };
    }
    return body;
  }

  test('runMessage is never thrown, and its Handler runs exactly when the body was read', async () => {
    let next = 219;
    const draw = () => {
      next = (Math.imul(next, 1664525) + 1013904223) >>> 0;
      return next / 2 ** 32;
    };
    const ran: boolean[] = [];
    const nestHandler = handle(nesting, () => {
      ran.push(true);
    });
    const runs: string[] = [];

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const depth = 1 + Math.floor(20_000 ** draw() * draw());
      const run = await runMessage(nestHandler, {
        body: nestedTo(depth),
        meta,
        resources: undefined,
      });
      runs.push(`${run.kind} ${ran.length}`);
      ran.length = 0;
    }

    expect(new Set(runs)).toEqual(new Set(['answered 1', 'invalid-call 0']));
  });
});

describe('mappedHandlerOf, by its key', () => {
  test('mappedHandlerOf names the key of a missing Handler, or of one written for another declaration', () => {
    const chargeCardHandler = handle(chargeCard, () => undefined);
    const at = { map: 'commands', key: 'chargeCardV1' } as const;

    const lookups = [
      () => mappedHandlerOf({}, at, chargeCardV1),
      () => mappedHandlerOf(Object.create({ chargeCardV1: chargeCardHandler }), at, chargeCardV1),
      () =>
        mappedHandlerOf({ chargeCardV1: handle(notifyOnPaid, () => undefined) }, at, chargeCardV1),
    ];

    expect(lookups.map(errorMessageOf)).toEqual([
      'commands.chargeCardV1 has no Handler in the Handler map: run cf-loom generate',
      'commands.chargeCardV1 has no Handler in the Handler map: run cf-loom generate',
      'commands.chargeCardV1 holds the Handler written for notifyOnPaid',
    ]);
  });

  test('mappedHandlerOf finds the Handler the map holds under its key', () => {
    const chargeCardHandler = handle(chargeCard, () => undefined);

    const found = mappedHandlerOf(
      { chargeCardV1: chargeCardHandler },
      { map: 'commands', key: 'chargeCardV1' },
      chargeCardV1,
    );

    expect(found).toBe(chargeCardHandler);
  });
});

/** Whether `mappedHandlerOf` finds a Handler for a declaration in a map that holds it. */
function isFoundFor(handler: unknown, declaration: Parameters<typeof mappedHandlerOf>[2]): boolean {
  return errorMessageOf(() => mappedHandlerOf({ handler }, anyKey, declaration)) === undefined;
}

const anyKey = { map: 'endpoints', key: 'handler' } as const;

function errorMessageOf(lookup: () => unknown): string | undefined {
  try {
    lookup();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : undefined;
  }
}

describe('checkedMessageBody', () => {
  test('a Message body is parsed with its schema, unknown keys stripped, its Issues at body', () => {
    const checks = [
      checkedMessageBody(orderBody, { orderId: ORDER_ID, extra: 'dropped' }),
      checkedMessageBody(orderBody, { orderId: 'nope' }),
    ];

    expect(checks).toEqual([
      { kind: 'value', value: { orderId: ORDER_ID } },
      {
        kind: 'issues',
        issues: [
          { part: 'body', path: ['orderId'], code: 'invalid_format', message: expect.any(String) },
        ],
      },
    ]);
  });
});

describe('writtenMessageBody', () => {
  const statuses = ['pending', 'paid'] as const;
  const reader = z.object({ orderId: z.uuid(), status: openEnumReader(statuses) });

  test('a body as a Subscriber reads it is written back through its Reader, its Issues at body', () => {
    const read = { orderId: ORDER_ID, status: { unknown: 'refunded' }, extra: 'dropped' };

    const checks = [
      writtenMessageBody(reader, read),
      writtenMessageBody(reader, { orderId: 'nope', status: 'paid' }),
    ];

    expect(checks).toEqual([
      { kind: 'value', value: { orderId: ORDER_ID, status: 'refunded' } },
      {
        kind: 'issues',
        issues: [
          { part: 'body', path: ['orderId'], code: 'invalid_format', message: expect.any(String) },
        ],
      },
    ]);
  });
});

describe('faultLineOf', () => {
  test('a Fault is a line of its source and message, its cause left out', () => {
    const fault = { message: 'Internal error', cause: new Error('gateway down') };

    const line = faultLineOf('getOrder', fault);

    expect(line).toBe('getOrder: Internal error');
  });
});

describe('logOf', () => {
  test('a line is logged alone, or then its cause when it has one', () => {
    const error = new Error('gateway down');

    const logs = [
      logOf('getOrder: Internal error', error),
      logOf('getOrder: Try again', undefined),
    ];

    expect(logs).toEqual([['getOrder: Internal error', error], ['getOrder: Try again']]);
  });
});

describe('faultLogOf', () => {
  test('a Fault is logged as its source and message, then its cause when it has one', () => {
    const error = new Error('gateway down');

    const logs = [
      faultLogOf('getOrder', { message: 'Internal error', cause: error }),
      faultLogOf('getOrder apiKey', { message: 'Try again' }),
    ];

    expect(logs).toEqual([['getOrder: Internal error', error], ['getOrder apiKey: Try again']]);
  });
});
