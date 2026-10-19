import {
  defineEndpoint,
  defineGuard,
  notFound,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { admit, fault, handle, reject, success } from '../index.ts';
import { isStub, isWrittenFor, runEndpoint, runGuard } from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const standards: StandardRejections = {
  invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
  notFound: { code: 'MISSING', status: 404, message: 'Nothing here' },
  notImplemented: { code: 'NOT_YET', status: 501, message: 'Not yet' },
};

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ clientId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The client holds a permission',
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

const getContext = { apiKey: { clientId: 'c-1' } };

describe('runEndpoint', () => {
  const getOrderHandler = handle(getOrder, () => reject(notFound));

  test('Input that breaks the Contract is invalid-input with its issues, never a throw', async () => {
    const call = { input: { params: { orderId: 'nope' } }, context: getContext };

    const run = await runEndpoint(getOrderHandler, call, standards);

    expect(run).toEqual({
      kind: 'invalid-input',
      issues: [
        {
          part: 'input.params',
          path: ['orderId'],
          code: 'invalid_format',
          message: expect.any(String),
        },
      ],
    });
  });

  test('an Outcome that breaks the Contract is invalid-outcome with its issues', async () => {
    const brokenHandler = handle(getOrder, () => success({ id: 'nope' }));
    const call = { input: { params: { orderId: ORDER_ID } }, context: getContext };

    const run = await runEndpoint(brokenHandler, call, standards);

    expect(run).toMatchObject({ kind: 'invalid-outcome', issues: [{ part: 'success.body' }] });
  });

  test('an answer is the resolved Outcome, Standard Rejections resolved with the given ones', async () => {
    const call = { input: { params: { orderId: ORDER_ID } }, context: getContext };

    const run = await runEndpoint(getOrderHandler, call, standards);

    expect(run).toEqual({
      kind: 'answered',
      answer: {
        kind: 'rejection',
        rejection: notFound,
        code: 'MISSING',
        status: 404,
        message: 'Nothing here',
      },
    });
  });
});

describe('runGuard', () => {
  const permissionHandler = handle(permission, () => admit());

  test('demands, a Context and a Qualifier that break the Contract are invalid-input', async () => {
    const apiKeyHandler = handle(apiKey, () => admit({ clientId: 'c-1' }));
    const call = { demands: {}, context: { apiKey: {} }, qualifier: 'orders:delete' };

    const runs = [
      await runGuard(apiKeyHandler, { ...call, context: {}, qualifier: undefined }, standards),
      await runGuard(permissionHandler, call, standards),
    ];

    expect(runs).toMatchObject([
      { kind: 'invalid-input', issues: [{ part: 'demands.headers', code: 'required' }] },
      {
        kind: 'invalid-input',
        issues: [
          { part: 'context', path: ['apiKey', 'clientId'] },
          { part: 'qualifier', code: 'invalid_value' },
        ],
      },
    ]);
  });

  test('an admitted Context that breaks the Contract is invalid-outcome', async () => {
    const apiKeyHandler = handle(apiKey, () => admit({ clientId: 7 }) as never);
    const call = { demands: { headers: { 'x-api-key': 'k' } }, context: {}, qualifier: undefined };

    const run = await runGuard(apiKeyHandler, call, standards);

    expect(run).toMatchObject({ kind: 'invalid-outcome', issues: [{ part: 'context' }] });
  });

  test('an answer is the resolved Admission, a stub’s Rejection resolved with the given ones', async () => {
    const call = { demands: { headers: { 'x-api-key': 'k' } }, context: {}, qualifier: undefined };

    const run = await runGuard(handle.stub(apiKey), call, standards);

    expect(run).toMatchObject({ kind: 'answered', answer: { code: 'NOT_YET', status: 501 } });
  });
});

describe('a run of a Handler that throws or returns no Outcome', () => {
  test('a throw is thrown, its Fault carrying the error, never answered', async () => {
    const error = new Error('database down');
    const getOrderHandler = handle(getOrder, () => {
      throw error;
    });
    const call = { input: { params: { orderId: ORDER_ID } }, context: getContext };

    const run = await runEndpoint(getOrderHandler, call, standards);

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

  test('a Guard returning success() is thrown, not a throw of the run', async () => {
    const apiKeyHandler = handle(apiKey, () => success() as never);
    const call = { demands: { headers: { 'x-api-key': 'k' } }, context: {}, qualifier: undefined };

    const run = await runGuard(apiKeyHandler, call, standards);

    expect(run).toMatchObject({
      kind: 'thrown',
      fault: { cause: new TypeError("apiKey's Handler returned no Outcome but the kind success") },
    });
  });

  test('a Fault the Handler returns is answered', async () => {
    const getOrderHandler = handle(getOrder, () => fault({ committed: 'no', retryable: true }));
    const call = { input: { params: { orderId: ORDER_ID } }, context: getContext };

    const run = await runEndpoint(getOrderHandler, call, standards);

    expect(run).toMatchObject({ kind: 'answered', answer: { kind: 'fault', committed: 'no' } });
  });
});

describe('what a run tells to be no Outcome', () => {
  const endpointCall = { input: { params: { orderId: ORDER_ID } }, context: getContext };
  const guardCall = {
    demands: { headers: { 'x-api-key': 'k' } },
    context: {},
    qualifier: undefined,
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

    const run = await runEndpoint(getOrderHandler, endpointCall, standards);

    expect(run.kind).toBe('thrown');
  });

  test('a GuardHandler returning an admission without its Context is thrown', async () => {
    const apiKeyHandler = handle(apiKey, () => ({ kind: 'admitted' }) as never);

    const run = await runGuard(apiKeyHandler, guardCall, standards);

    expect(run.kind).toBe('thrown');
  });

  test('a Fault a GuardHandler returns is answered', async () => {
    const apiKeyHandler = handle(apiKey, () => fault({ committed: 'no', retryable: true }));

    const run = await runGuard(apiKeyHandler, guardCall, standards);

    expect(run).toMatchObject({ kind: 'answered', answer: { kind: 'fault', committed: 'no' } });
  });
});

describe('a Handler of another kind', () => {
  test('runGuard given an EndpointHandler throws Not a Handler', () => {
    const getOrderHandler = handle(getOrder, () => reject(notFound));
    const call = { demands: {}, context: {}, qualifier: undefined };

    const run = () => runGuard(getOrderHandler as never, call, standards);

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
});

describe('isWrittenFor', () => {
  test('a Handler is told written for its own Element, not another, and a plain function never', () => {
    const getOrderHandler = handle(getOrder, () => reject(notFound));
    const apiKeyHandler = handle(apiKey, () => admit({ clientId: 'c-1' }));
    const lookalike = Object.assign(() => undefined, { element: getOrder });

    const written = [
      isWrittenFor(getOrderHandler, getOrder),
      isWrittenFor(apiKeyHandler, apiKey),
      isWrittenFor(getOrderHandler, apiKey),
      isWrittenFor(handle.stub(permission), apiKey),
      isWrittenFor(lookalike, getOrder),
      isWrittenFor(undefined, getOrder),
    ];

    expect(written).toEqual([true, true, false, false, false, false]);
  });
});
