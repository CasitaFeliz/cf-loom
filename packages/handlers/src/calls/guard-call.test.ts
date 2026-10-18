import { defineGuard, defineRejection, notImplemented } from '@casitafeliz/loom-contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  admit,
  handle,
  InvalidInputError,
  InvalidOutcomeError,
  type Issue,
  reject,
} from '../index.ts';

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per client',
  demands: { headers: z.object({ 'x-api-key': z.string().min(4) }) },
  context: z.object({ clientId: z.string() }),
  rejections: [unauthenticated],
});

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
  rejections: [unauthenticated],
});

const internalOnly = defineGuard({ name: 'internalOnly', description: 'Only the network' });

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken, internalOnly],
  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),
  rejections: [forbidden],
});

const apiKeyDemands = { headers: { 'x-api-key': 'key-1' } };
const userContext = { userToken: { userId: 'u-1' } };

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

describe('a GuardHandler’s direct call', () => {
  test('the implementation receives the parsed demands and no Context when none is listed', async () => {
    const received: unknown[] = [];
    const apiKeyHandler = handle(apiKey, (demands, context) => {
      received.push(demands, context);
      return admit({ clientId: 'c-1' });
    });

    await apiKeyHandler({ headers: { 'x-api-key': 'key-1', other: 'x' } } as never, {});

    expect(received).toEqual([apiKeyDemands, {}]);
  });

  test('the implementation receives the Context of the Guards it lists and its Qualifier', async () => {
    const received: unknown[] = [];
    const permissionHandler = handle(permission, (demands, context, qualifier) => {
      received.push(demands, context, qualifier);
      return admit();
    });

    await permissionHandler({}, userContext, ['orders:edit']);

    expect(received).toEqual([{}, userContext, ['orders:edit']]);
  });

  test('demands that break a schema throw InvalidInputError', async () => {
    const apiKeyHandler = handle(apiKey, () => admit({ clientId: 'c-1' }));

    const issues = await issuesOf(() => apiKeyHandler({ headers: { 'x-api-key': 'k' } }, {}));

    expect(issues).toEqual([
      {
        part: 'demands.headers',
        path: ['x-api-key'],
        code: 'too_small',
        message: expect.any(String),
      },
    ]);
  });

  test('a Context of a listed Guard that breaks its schema throws InvalidInputError', async () => {
    const permissionHandler = handle(permission, () => admit());

    const issues = await issuesOf(() =>
      permissionHandler({}, { userToken: {} } as never, ['orders:edit']),
    );

    expect(issues).toEqual([
      {
        part: 'context',
        path: ['userToken', 'userId'],
        code: 'required',
        message: expect.any(String),
      },
    ]);
  });

  test('a Qualifier that breaks its schema throws InvalidInputError', async () => {
    const permissionHandler = handle(permission, () => admit());

    const issues = await issuesOf(() => permissionHandler({}, userContext, [] as never));

    expect(issues).toEqual([
      { part: 'qualifier', path: [], code: 'too_small', message: expect.any(String) },
    ]);
  });

  test('admit(context) resolves to the request admitted with the parsed Context', async () => {
    const apiKeyHandler = handle(apiKey, () => admit({ clientId: 'c-1', extra: true }));

    const admission = await apiKeyHandler(apiKeyDemands, {});

    expect(admission).toEqual({ kind: 'admitted', context: { clientId: 'c-1' } });
  });

  test('admit() admits for a Guard without a context', async () => {
    const internalOnlyHandler = handle(internalOnly, () => admit());

    const admission = await internalOnlyHandler({}, {});

    expect(admission).toEqual({ kind: 'admitted', context: undefined });
  });

  test('an admit() that breaks the Guard’s context schema throws InvalidOutcomeError', async () => {
    const apiKeyHandler = handle(apiKey, () => admit() as never);

    const issues = await issuesOf(() => apiKeyHandler(apiKeyDemands, {}));

    expect(issues).toEqual([
      { part: 'context', path: [], code: 'required', message: expect.any(String) },
    ]);
  });

  test('a Context admitted by a Guard without a context schema throws InvalidOutcomeError', async () => {
    const internalOnlyHandler = handle(internalOnly, () => admit({ clientId: 'c-1' }) as never);

    const issues = await issuesOf(() => internalOnlyHandler({}, {}));

    expect(issues).toEqual([
      { part: 'context', path: [], code: 'invalid_type', message: 'Expected no value' },
    ]);
  });

  test('reject(unauthenticated) resolves with the Guard’s own code, status and message', async () => {
    const apiKeyHandler = handle(apiKey, () => reject(unauthenticated));

    const admission = await apiKeyHandler(apiKeyDemands, {});

    expect(admission).toEqual({
      kind: 'rejection',
      rejection: unauthenticated,
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Unauthenticated',
    });
  });

  test('a Rejection the Guard does not list throws InvalidOutcomeError through a cast', async () => {
    const apiKeyHandler = handle(apiKey, () => reject(forbidden) as never);

    const issues = await issuesOf(() => apiKeyHandler(apiKeyDemands, {}));

    expect(issues).toEqual([
      {
        part: 'rejections',
        path: [],
        code: 'invalid_value',
        message: 'FORBIDDEN is not a Rejection apiKey answers',
      },
    ]);
  });

  test('a Rejection the Guard does not list is a type error', () => {
    // @ts-expect-error forbidden is not a Rejection apiKey answers
    const write = () => handle(apiKey, () => reject(forbidden));

    expect(write).not.toThrow();
  });

  test('a GuardHandler that throws answers the Fault with the error as cause', async () => {
    const error = new Error('key store down');
    const apiKeyHandler = handle(apiKey, async () => {
      throw error;
    });

    const admission = await apiKeyHandler(apiKeyDemands, {});

    expect(admission).toEqual({
      kind: 'fault',
      committed: 'unknown',
      retryable: false,
      message: 'Internal error',
      cause: error,
    });
  });

  test('a Guard stub answers not-implemented and never admits', async () => {
    const stub = handle.stub(apiKey);

    const admission = await stub(apiKeyDemands, {});

    expect(admission).toEqual({
      kind: 'rejection',
      rejection: notImplemented,
      code: 'NOT_IMPLEMENTED',
      status: 501,
      message: 'Not implemented',
    });
  });

  test('a Guard without a qualifier takes two arguments and one with a qualifier three', () => {
    const apiKeyHandler = handle(apiKey, () => admit({ clientId: 'c-1' }));
    const permissionHandler = handle(permission, () => admit());

    const call = () => [
      // @ts-expect-error apiKey declares no qualifier
      apiKeyHandler(apiKeyDemands, {}, ['orders:edit']),
      // @ts-expect-error permission declares a qualifier
      permissionHandler({}, userContext),
    ];

    expect(call).toBeDefined();
  });
});
