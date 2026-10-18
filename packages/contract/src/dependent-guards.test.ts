import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, defineGuard, type RequiredContextOf } from './index.ts';

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
});

const internalOnly = defineGuard({
  name: 'internalOnly',
  description: 'Only the internal network',
});

const tenant = defineGuard({
  name: 'tenant',
  description: 'The tenant the user acts for',
  guards: [userToken, internalOnly],
  context: z.object({ tenantId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The user may act for the tenant',
  guards: [userToken, tenant],
});

const endpoint = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

describe('dependent Guards', () => {
  test('a Guard lists the Guards whose Context it reads', () => {
    expect(tenant.guards[0]).toBe(userToken);
    expect(tenant.guards[1]).toBe(internalOnly);
  });

  test('a dependent Guard’s required Context is typed by name and has no other key', () => {
    expectTypeOf<RequiredContextOf<typeof tenant>>().toEqualTypeOf<{
      readonly userToken: { userId: string };
    }>();
    expectTypeOf<RequiredContextOf<typeof userToken>>().toEqualTypeOf<Record<never, never>>();
  });

  test('a missing or later-listed required Guard is a type error', () => {
    const declare = () => [
      // @ts-expect-error permission requires tenant earlier in guards
      defineEndpoint({ ...endpoint, guards: [userToken, permission] }),
      // @ts-expect-error tenant requires userToken earlier in guards
      defineEndpoint({ ...endpoint, guards: [internalOnly, tenant, userToken] }),
    ];

    expect(declare).not.toThrow();
  });

  test('a Guard listed twice is a type error', () => {
    // @ts-expect-error userToken is listed twice
    const declare = () => defineEndpoint({ ...endpoint, guards: [userToken, userToken] });

    expect(declare).not.toThrow();
  });

  test('a chain of three Guards type-checks in order', () => {
    const listOrders = defineEndpoint({
      ...endpoint,
      guards: [userToken, internalOnly, tenant, permission],
    });

    expect(listOrders.guards).toEqual([userToken, internalOnly, tenant, permission]);
  });
});

describe('dependent Guards in a diamond', () => {
  const region = defineGuard({
    name: 'region',
    description: 'The region the user acts in',
    guards: [userToken],
    context: z.object({ region: z.string() }),
  });
  const audit = defineGuard({
    name: 'audit',
    description: 'Records who acts where',
    guards: [tenant, region],
  });

  test('a Guard needing two Guards that share one type-checks once both come earlier', () => {
    const listOrders = defineEndpoint({
      ...endpoint,
      guards: [userToken, internalOnly, tenant, region, audit],
    });

    expect(listOrders.guards).toHaveLength(5);
  });

  test('a Guard listed before one of the two it needs is a type error', () => {
    const declare = () =>
      // @ts-expect-error audit requires region earlier in guards
      defineEndpoint({ ...endpoint, guards: [userToken, internalOnly, tenant, audit, region] });

    expect(declare).not.toThrow();
  });
});

describe('dependent Guards typed wider than literals', () => {
  test('a Guard whose name is a plain string skips the order rule', () => {
    const name: string = 'userToken';
    const widened = defineGuard({ name, description: 'A signed-in user' });

    const listOrders = defineEndpoint({ ...endpoint, guards: [widened, widened] });

    expect(listOrders.guards).toHaveLength(2);
  });
});
