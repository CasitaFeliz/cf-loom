import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type ContextOf,
  defineEndpoint,
  defineGuard,
  defineRejection,
  type invalidInput,
  notFound,
  type notImplemented,
  type ProvidedContextOf,
  type RejectionsOf,
} from './index.ts';

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ clientId: z.string() }),
  rejections: [unauthenticated],
});

const internalOnly = defineGuard({
  name: 'internalOnly',
  description: 'Only the internal network',
});

describe('defineGuard', () => {
  test('a Guard may demand query params', () => {
    const query = z.object({ page: z.int() });

    const paged = defineGuard({
      name: 'paged',
      description: 'A page of results',
      demands: { query },
    });

    expect(paged.demands.query).toBe(query);
  });

  test('a Guard declares a qualifier schema and keeps it by identity', () => {
    const qualifier = z.array(z.string()).min(1);

    const permission = defineGuard({
      name: 'permission',
      description: 'The user holds every listed permission',
      qualifier,
    });

    expect(permission.qualifier).toBe(qualifier);
  });

  test('a Guard demanding the body is a type error', () => {
    const declare = () =>
      defineGuard({
        name: 'signed',
        description: 'A signed body',
        // @ts-expect-error a Guard demands only headers and query
        demands: { body: z.object({ signature: z.string() }) },
      });

    expect(declare).not.toThrow();
  });

  test('a Guard demanding path params is a type error', () => {
    const declare = () =>
      defineGuard({
        name: 'tenant',
        description: 'A tenant in the path',
        // @ts-expect-error a Guard demands only headers and query
        demands: { params: z.object({ tenantId: z.string() }) },
      });

    expect(declare).not.toThrow();
  });

  test('a Standard Rejection on a Guard is a type error', () => {
    const declare = () =>
      defineGuard({
        name: 'tenant',
        description: 'The tenant the client acts for',
        // @ts-expect-error a Guard lists declared Rejections only
        rejections: [notFound],
      });

    expect(declare).not.toThrow();
  });

  test('an upper-case header name is a type error', () => {
    const declare = () =>
      defineGuard({
        name: 'apiKey',
        description: 'A key per client',
        // @ts-expect-error header names are lower-case
        demands: { headers: z.object({ 'X-Api-Key': z.string() }) },
      });

    expect(declare).not.toThrow();
  });

  test('a Guard’s provided Context is typed by its context schema', () => {
    expectTypeOf<ProvidedContextOf<typeof apiKey>>().toEqualTypeOf<{ clientId: string }>();
  });

  test('a Guard without a context schema provides undefined', () => {
    expectTypeOf<ProvidedContextOf<typeof internalOnly>>().toEqualTypeOf<undefined>();
  });

  test('the Context of an Endpoint has one key per Guard that provides a Context, by name', () => {
    const getOrder = defineEndpoint({
      name: 'getOrder',
      method: 'GET',
      path: '/orders',
      visibility: 'internal',
      description: 'The latest order',
      guards: [apiKey, internalOnly],
      success: { status: 200, body: z.object({ id: z.uuid() }) },
    });

    expectTypeOf<ContextOf<typeof getOrder>>().toEqualTypeOf<{
      readonly apiKey: { clientId: string };
    }>();
  });

  test('an Endpoint answers its own Rejections, its Guards’ and the two the runtime adds', () => {
    const getOrder = defineEndpoint({
      name: 'getOrder',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'The latest order',
      guards: [apiKey],
      success: { status: 200, body: z.object({ id: z.uuid() }) },
      rejections: [notFound],
    });

    expectTypeOf<RejectionsOf<typeof getOrder>>().toEqualTypeOf<
      typeof notFound | typeof unauthenticated | typeof invalidInput | typeof notImplemented
    >();
  });
});

describe('defineGuard fields', () => {
  test('an undeclared field is a type error', () => {
    const declare = () =>
      defineGuard({
        name: 'permission',
        description: 'The user holds a permission',
        // @ts-expect-error audience is not a declared field
        audience: z.array(z.string()),
      });

    expect(declare).not.toThrow();
  });
});

describe('a declared Guard’s containers', () => {
  test('a Guard freezes its containers and keeps its schemas', () => {
    const headers = z.object({ 'x-tenant': z.string() });
    const demands = { headers };
    const guards = [apiKey];

    const tenant = defineGuard({
      name: 'tenant',
      description: 'The tenant the client acts for',
      demands,
      guards,
      rejections: [unauthenticated],
    });
    Reflect.set(demands, 'headers', z.object({}));
    guards.pop();

    expect(tenant.demands.headers).toBe(headers);
    expect(tenant.guards).toEqual([apiKey]);
    expect(Object.isFrozen(tenant.demands)).toBe(true);
    expect(Object.isFrozen(tenant.guards)).toBe(true);
    expect(Object.isFrozen(tenant.rejections)).toBe(true);
  });
});

describe('defineGuard nested fields', () => {
  test('an undeclared field in demands is a type error', () => {
    const declare = () =>
      defineGuard({
        name: 'apiKey',
        description: 'A key per client',
        demands: {
          query: z.object({ page: z.int() }),
          // @ts-expect-error header is not a part of demands
          header: z.object({ 'x-api-key': z.string() }),
        },
      });

    expect(declare).not.toThrow();
  });
});
