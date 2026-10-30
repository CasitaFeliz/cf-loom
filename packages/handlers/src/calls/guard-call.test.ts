import { defineGuard, defineRejection, type Guard, notImplemented } from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  admit,
  type CheckedAdmission,
  type GuardCall,
  type GuardImplementation,
  type HandledRequest,
  handle,
  InvalidCallError,
  InvalidOutcomeError,
  type Issue,
  reject,
  type WithResources,
} from '../index.ts';

/** `admit` as a JavaScript Handler calls it, its Context unchecked, to reach the runtime's own check. */
const admitUnchecked = admit as (guard: Guard, context?: unknown) => never;

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const tokenExpired = defineRejection({
  code: 'TOKEN_EXPIRED',
  status: 401,
  message: 'The token expired',
  headers: z.object({ 'www-authenticate': z.string() }),
});

const bearer = defineGuard({
  name: 'bearer',
  description: 'A bearer token',
  demands: { headers: z.object({ authorization: z.string() }) },
  rejections: [tokenExpired],
});

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

type Held = { readonly permissions: { readonly held: readonly string[] } };
type Keyed = { readonly callers: { readonly byKey: () => string } };

const apiKeyDemands = { headers: { 'x-api-key': 'key-1' } };
const userContext = { userToken: { userId: 'u-1' } };

async function issuesOf(call: () => Promise<unknown>): Promise<readonly Issue[]> {
  try {
    await call();
  } catch (e) {
    if (e instanceof InvalidCallError || e instanceof InvalidOutcomeError) {
      return e.issues;
    }
    throw e;
  }
  throw new Error('the call did not throw');
}

describe('a GuardHandler’s second argument', () => {
  test('the implementation receives its Qualifier in its second argument, beside its Context', async () => {
    const received: unknown[] = [];
    const permissionHandler = handle(permission, (_demands, { context, qualifier }) => {
      received.push(context, qualifier);
      return admit(permission);
    });

    await permissionHandler({}, { context: userContext, qualifier: ['orders:edit'] });

    expect(received).toEqual([userContext, ['orders:edit']]);
  });

  test('a GuardHandler that returns no Admission answers a Fault naming the Admission', async () => {
    const apiKeyHandler = handle(apiKey, () => ({ kind: 'success', value: undefined }) as never);

    const admission = await apiKeyHandler(apiKeyDemands, {});

    expect(admission).toMatchObject({
      kind: 'fault',
      cause: new TypeError("apiKey's Handler returned no Admission but the kind success"),
    });
  });

  test('a direct call may leave out the Context only when no Guard gives the Handler one', () => {
    const permissionHandler = handle.stub(permission);
    const apiKeyHandler = handle.stub(apiKey);

    // @ts-expect-error TS2345 permission lists userToken, which gives it a Context
    const withoutContext = () => permissionHandler({}, { qualifier: ['orders:edit'] });

    expectTypeOf(apiKeyHandler).toBeCallableWith(apiKeyDemands, {});
    expect(withoutContext).toBeTypeOf('function');
  });
});

describe('a GuardHandler’s direct call', () => {
  test('the implementation receives the parsed demands and no Context when none is listed', async () => {
    const received: unknown[] = [];
    const apiKeyHandler = handle(apiKey, (demands, { context }) => {
      received.push(demands, context);
      return admit(apiKey, { callerId: 'c-1' });
    });

    await apiKeyHandler({ headers: { 'x-api-key': 'key-1', other: 'x' } } as never, {});

    expect(received).toEqual([apiKeyDemands, {}]);
  });

  test('the implementation receives its Qualifier and the Resources its direct call is given, and its Context without them', async () => {
    const resources = { permissions: { held: ['orders:edit'] } };
    const received: unknown[] = [];
    const permissionHandler = handle(
      permission,
      (_demands, { context, qualifier }, { resources: taken }: WithResources<Held>) => {
        received.push(context, qualifier, taken);
        return admit(permission);
      },
    );

    await permissionHandler(
      {},
      { context: userContext, qualifier: ['orders:edit'] },
      { resources },
    );

    expect(received).toHaveLength(3);
    expect(received[0]).toStrictEqual(userContext);
    expect(received[1]).toEqual(['orders:edit']);
    expect(received[2]).toBe(resources);
  });

  test('a Guard that declares no Qualifier receives the Resources its direct call is given', async () => {
    const resources = { callers: { byKey: () => 'c-1' } };
    const received: unknown[] = [];
    const apiKeyHandler = handle(
      apiKey,
      (_demands, _call, { resources: taken }: WithResources<Keyed>) => {
        received.push(taken);
        return admit(apiKey, { callerId: taken.callers.byKey() });
      },
    );

    const admission = await apiKeyHandler(apiKeyDemands, {}, { resources });

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(resources);
    expect(admission).toEqual({ kind: 'admitted', context: { callerId: 'c-1' } });
  });

  test('demands that break a schema throw InvalidCallError', async () => {
    const apiKeyHandler = handle(apiKey, () => admit(apiKey, { callerId: 'c-1' }));

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

  test('a Context of a listed Guard that breaks its schema throws InvalidCallError', async () => {
    const permissionHandler = handle(permission, () => admit(permission));

    const issues = await issuesOf(() =>
      permissionHandler({}, { context: { userToken: {} } as never, qualifier: ['orders:edit'] }),
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

  test('a Qualifier that breaks its schema throws InvalidCallError', async () => {
    const permissionHandler = handle(permission, () => admit(permission));

    const issues = await issuesOf(() =>
      permissionHandler({}, { context: userContext, qualifier: [] as never }),
    );

    expect(issues).toEqual([
      { part: 'qualifier', path: [], code: 'too_small', message: expect.any(String) },
    ]);
  });

  test('admit(guard, context) resolves to the request admitted with the parsed Context', async () => {
    const caller = { callerId: 'c-1', extra: true };
    const apiKeyHandler = handle(apiKey, () => admit(apiKey, caller));

    const admission = await apiKeyHandler(apiKeyDemands, {});

    expect(admission).toEqual({ kind: 'admitted', context: { callerId: 'c-1' } });
  });

  test('admit(guard) admits for a Guard without a context', async () => {
    const internalOnlyHandler = handle(internalOnly, () => admit(internalOnly));

    const admission = await internalOnlyHandler({}, {});

    expect(admission).toEqual({ kind: 'admitted', context: undefined });
  });

  test('an admit(guard) that breaks the Guard’s context schema throws InvalidOutcomeError', async () => {
    const apiKeyHandler = handle(apiKey, () => admitUnchecked(apiKey));

    const issues = await issuesOf(() => apiKeyHandler(apiKeyDemands, {}));

    expect(issues).toEqual([
      { part: 'context', path: [], code: 'required', message: expect.any(String) },
    ]);
  });

  test('a Context admitted by a Guard without a context schema throws InvalidOutcomeError', async () => {
    const internalOnlyHandler = handle(internalOnly, () =>
      admitUnchecked(internalOnly, { callerId: 'c-1' }),
    );

    const issues = await issuesOf(() => internalOnlyHandler({}, {}));

    expect(issues).toEqual([
      { part: 'context', path: [], code: 'invalid_type', message: 'Expected no value' },
    ]);
  });

  test('reject(unauthenticated) comes back as built, its declaration and no code', async () => {
    const apiKeyHandler = handle(apiKey, () => reject(unauthenticated));

    const admission = await apiKeyHandler(apiKeyDemands, {});

    expect(admission).toStrictEqual({ kind: 'rejection', rejection: unauthenticated });
  });

  test('a Rejection with headers comes back as built with its headers parsed', async () => {
    const challenge = 'Bearer error="invalid_token"';
    const bearerHandler = handle(bearer, () =>
      reject(tokenExpired, { headers: { 'www-authenticate': challenge } }),
    );

    const admission = await bearerHandler({ headers: { authorization: 'Bearer t' } }, {});

    expect(admission).toStrictEqual({
      kind: 'rejection',
      rejection: tokenExpired,
      headers: { 'www-authenticate': challenge },
    });
  });

  test('a Rejection header that cannot travel throws InvalidOutcomeError at headers', async () => {
    const bearerHandler = handle(bearer, () =>
      reject(tokenExpired, { headers: { 'www-authenticate': 'Bearer\n' } }),
    );

    const issues = await issuesOf(() =>
      bearerHandler({ headers: { authorization: 'Bearer t' } }, {}),
    );

    expect(issues).toEqual([
      {
        part: 'headers',
        path: ['www-authenticate'],
        code: 'invalid_format',
        message: expect.any(String),
      },
    ]);
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
    // @ts-expect-error TS2322 forbidden is not a Rejection apiKey answers
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

  test('a Guard stub returns the not-implemented Rejection as built and never admits', async () => {
    const stub = handle.stub(apiKey);

    const admission = await stub(apiKeyDemands, {});

    expect(admission).toStrictEqual({ kind: 'rejection', rejection: notImplemented });
  });

  test('a Guard that declares a Qualifier, called without it, is a type error', () => {
    const apiKeyHandler = handle(apiKey, () => admit(apiKey, { callerId: 'c-1' }));
    const permissionHandler = handle(permission, () => admit(permission));

    const call = () => [
      apiKeyHandler(apiKeyDemands, {}),
      // @ts-expect-error TS2322 apiKey declares no qualifier
      apiKeyHandler(apiKeyDemands, {}, { qualifier: ['orders:edit'] }),
      // @ts-expect-error TS2345 permission declares a qualifier
      permissionHandler({}, userContext),
      // @ts-expect-error TS2345 permission declares a qualifier
      permissionHandler({}, userContext, {}),
    ];

    expect(call).toBeDefined();
  });

  test('a Guard stub given demands that break the Contract throws InvalidCallError', async () => {
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
    const regionalHandler = handle(regional, (_demands, { context, qualifier }) => {
      received.push(context, qualifier);
      return admit(regional);
    });
    const context = { userToken: { userId: 'u-1', extra: true } } as never;

    await regionalHandler({}, { context, qualifier: { region: 'emea', extra: true } as never });

    expect(received).toEqual([userContext, { region: 'emea' }]);
  });

  test('a Qualifier given to a Guard that declares none throws InvalidCallError', async () => {
    const apiKeyHandler = handle(apiKey, () => admit(apiKey, { callerId: 'c-1' }));

    const issues = await issuesOf(() =>
      Reflect.apply(apiKeyHandler, undefined, [apiKeyDemands, { qualifier: ['orders:edit'] }]),
    );

    expect(issues).toEqual([
      { part: 'qualifier', path: [], code: 'invalid_type', message: 'Expected no value' },
    ]);
  });

  test('admit(guard) without the Context its Guard provides, or with a wrong one, is a type error', () => {
    const write = () => [
      // @ts-expect-error TS2554 apiKey provides a Context
      handle(apiKey, () => admit(apiKey)),
      // @ts-expect-error TS2322 callerId is a string
      handle(apiKey, () => admit(apiKey, { callerId: 7 })),
    ];

    expect(write).not.toThrow();
  });

  test('a GuardImplementation receives the Context of the Guards it lists, its Qualifier and the request', () => {
    expectTypeOf<Parameters<GuardImplementation<typeof permission>>[1]>().toEqualTypeOf<
      GuardCall<typeof permission>
    >();
    expectTypeOf<GuardCall<typeof permission>['context']>().toEqualTypeOf<{
      readonly userToken: { userId: string };
    }>();
    expectTypeOf<GuardCall<typeof permission>['qualifier']>().toEqualTypeOf<
      ('orders:read' | 'orders:edit')[]
    >();
    expectTypeOf<GuardCall<typeof permission>['request']>().toEqualTypeOf<HandledRequest>();
  });

  test('a GuardHandler’s direct call answers the Guard’s Rejections and not-implemented', () => {
    type Rejected = Extract<CheckedAdmission<typeof apiKey>, { kind: 'rejection' }>;

    expectTypeOf<Rejected['rejection']>().toEqualTypeOf<
      typeof unauthenticated | typeof notImplemented
    >();
  });
});
