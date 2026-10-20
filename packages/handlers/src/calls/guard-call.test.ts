import { defineGuard, defineRejection, notImplemented } from '@casitafeliz/loom-contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  admit,
  type GuardImplementation,
  handle,
  InvalidInputError,
  InvalidOutcomeError,
  type Issue,
  type ResolvedAdmission,
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
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string().min(4) }) },
  context: z.object({ callerId: z.string() }),
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
      return admit({ callerId: 'c-1' });
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
    const apiKeyHandler = handle(apiKey, () => admit({ callerId: 'c-1' }));

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
    const apiKeyHandler = handle(apiKey, () => admit({ callerId: 'c-1', extra: true }));

    const admission = await apiKeyHandler(apiKeyDemands, {});

    expect(admission).toEqual({ kind: 'admitted', context: { callerId: 'c-1' } });
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
    const internalOnlyHandler = handle(internalOnly, () => admit({ callerId: 'c-1' }) as never);

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
    const apiKeyHandler = handle(apiKey, () => admit({ callerId: 'c-1' }));
    const permissionHandler = handle(permission, () => admit());

    const call = () => [
      // @ts-expect-error apiKey declares no qualifier
      apiKeyHandler(apiKeyDemands, {}, ['orders:edit']),
      // @ts-expect-error permission declares a qualifier
      permissionHandler({}, userContext),
    ];

    expect(call).toBeDefined();
  });

  test('a Guard stub given demands that break the Contract throws InvalidInputError', async () => {
    const stub = handle.stub(apiKey);

    const issues = await issuesOf(() => stub({ headers: {} } as never, {}));

    expect(issues.map(({ part, path }) => ({ part, path }))).toEqual([
      { part: 'demands.headers', path: ['x-api-key'] },
    ]);
  });

  test('the parsed Context and Qualifier reach the implementation, unknown keys stripped', async () => {
    const regional = defineGuard({
      name: 'regional',
      description: 'The user works in a region',
      guards: [userToken],
      qualifier: z.object({ region: z.string() }),
    });
    const received: unknown[] = [];
    const regionalHandler = handle(regional, (_demands, context, qualifier) => {
      received.push(context, qualifier);
      return admit();
    });
    const context = { userToken: { userId: 'u-1', extra: true } } as never;

    await regionalHandler({}, context, { region: 'emea', extra: true } as never);

    expect(received).toEqual([userContext, { region: 'emea' }]);
  });

  test('a Qualifier given to a Guard that declares none throws InvalidInputError', async () => {
    const apiKeyHandler = handle(apiKey, () => admit({ callerId: 'c-1' }));

    const issues = await issuesOf(() =>
      Reflect.apply(apiKeyHandler, undefined, [apiKeyDemands, {}, ['orders:edit']]),
    );

    expect(issues).toEqual([
      { part: 'qualifier', path: [], code: 'invalid_type', message: 'Expected no value' },
    ]);
  });

  test('admit() without the Context its Guard provides, or with a wrong one, is a type error', () => {
    const write = () => [
      // @ts-expect-error apiKey provides a Context
      handle(apiKey, () => admit()),
      // @ts-expect-error callerId is a string
      handle(apiKey, () => admit({ callerId: 7 })),
    ];

    expect(write).not.toThrow();
  });

  test('a GuardImplementation receives the Context of the Guards it lists', () => {
    expectTypeOf<Parameters<GuardImplementation<typeof permission>>[1]>().toEqualTypeOf<{
      readonly userToken: { userId: string };
    }>();
  });

  test('a GuardHandler’s direct call answers the Guard’s Rejections and not-implemented', () => {
    type Rejected = Extract<ResolvedAdmission<typeof apiKey>, { kind: 'rejection' }>;

    expectTypeOf<Rejected['rejection']>().toEqualTypeOf<
      typeof unauthenticated | typeof notImplemented
    >();
  });
});
