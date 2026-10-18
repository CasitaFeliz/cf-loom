import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type ContextOf,
  defineEndpoint,
  defineGuard,
  defineRejection,
  type Guard,
  type invalidInput,
  type notImplemented,
  type QualifierOf,
  type RejectionsOf,
} from './index.ts';

const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),
  context: z.object({ granted: z.boolean() }),
  rejections: [forbidden],
});

const tenant = defineGuard({
  name: 'tenant',
  description: 'The request targets a tenant',
  qualifier: z.string(),
});

const region = defineGuard({
  name: 'region',
  description: 'The request is served in a region',
  qualifier: z.enum(['eu', 'us']),
});

const endpoint = {
  name: 'updateOrder',
  method: 'PUT',
  path: '/orders',
  visibility: 'public',
  description: 'Replaces the latest order',
  success: { status: 204 },
} as const;

describe('Attachments', () => {
  test('a Guard with a qualifier is listed as an Attachment', () => {
    const updateOrder = defineEndpoint({
      ...endpoint,
      guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
    });

    expect(updateOrder.guards[1]).toEqual({ guard: permission, qualifier: ['orders:edit'] });
  });

  test('an Endpoint may list only qualified Attachments', () => {
    const updateOrder = defineEndpoint({
      ...endpoint,
      guards: [{ guard: tenant, qualifier: 'acme' }],
    });

    expect(updateOrder.guards[0].guard).toBe(tenant);
  });

  test('an Endpoint may list two different qualified Guards', () => {
    const updateOrder = defineEndpoint({
      ...endpoint,
      guards: [
        { guard: tenant, qualifier: 'acme' },
        { guard: region, qualifier: 'eu' },
      ],
    });

    expect(updateOrder.guards[1].guard).toBe(region);
  });

  test('listing a Guard with a qualifier bare is a type error', () => {
    const declare = () =>
      // @ts-expect-error permission needs a qualifier: { guard, qualifier }
      defineEndpoint({ ...endpoint, guards: [userToken, permission] });

    expect(declare).not.toThrow();
  });

  test('an Attachment of a Guard without a qualifier is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...endpoint,
        // @ts-expect-error userToken takes no qualifier
        guards: [{ guard: userToken, qualifier: ['orders:edit'] }],
      });

    expect(declare).not.toThrow();
  });

  test('an Attachment whose value breaks the schema’s type is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...endpoint,
        // @ts-expect-error orders:delete is not a permission the schema accepts
        guards: [userToken, { guard: permission, qualifier: ['orders:delete'] }],
      });

    expect(declare).not.toThrow();
  });

  test('an Attachment with an undeclared field is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...endpoint,
        // @ts-expect-error reason is not a declared field
        guards: [userToken, { guard: permission, qualifier: ['orders:edit'], reason: 'audit' }],
      });

    expect(declare).not.toThrow();
  });

  test('an Attachment and its Qualifier are frozen copies, and its Guard is kept by identity', () => {
    const qualifier: ['orders:edit'] = ['orders:edit'];
    const attachment = { guard: permission, qualifier };

    const updateOrder = defineEndpoint({ ...endpoint, guards: [userToken, attachment] });
    qualifier.pop();

    const attached = updateOrder.guards[1];
    expect(attached).not.toBe(attachment);
    expect(attached.guard).toBe(permission);
    expect(attached.qualifier).toEqual(['orders:edit']);
    expect(Object.isFrozen(attached)).toBe(true);
    expect(Object.isFrozen(attached.qualifier)).toBe(true);
  });

  test('a Guard attached twice is listed twice', () => {
    const declare = () =>
      defineEndpoint({
        ...endpoint,
        // @ts-expect-error tenant is listed twice
        guards: [
          { guard: tenant, qualifier: 'acme' },
          { guard: tenant, qualifier: 'globex' },
        ],
      });

    expect(declare).not.toThrow();
  });
});

describe('Attachments and dependent Guards', () => {
  const audit = defineGuard({
    name: 'audit',
    description: 'Records what a permitted user does',
    guards: [userToken, permission],
  });

  test('a dependent Guard needs the Guard it lists earlier, bare or attached', () => {
    const updateOrder = defineEndpoint({
      ...endpoint,
      guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }, audit],
    });

    expect(updateOrder.guards[2]).toBe(audit);
  });

  test('a dependent Guard listed before the attached Guard it needs is a type error', () => {
    const declare = () =>
      defineEndpoint({
        ...endpoint,
        // @ts-expect-error audit requires permission earlier in guards
        guards: [userToken, audit, { guard: permission, qualifier: ['orders:edit'] }],
      });

    expect(declare).not.toThrow();
  });
});

describe('what an attached Guard adds to an Endpoint', () => {
  const updateOrder = defineEndpoint({
    ...endpoint,
    guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
  });

  test('an Endpoint’s Context includes an attached Guard’s', () => {
    expectTypeOf<ContextOf<typeof updateOrder>>().toEqualTypeOf<{
      readonly userToken: { userId: string };
      readonly permission: { granted: boolean };
    }>();
  });

  test('an Endpoint’s Rejections include an attached Guard’s', () => {
    expectTypeOf<RejectionsOf<typeof updateOrder>>().toEqualTypeOf<
      typeof forbidden | typeof invalidInput | typeof notImplemented
    >();
  });
});

describe('QualifierOf', () => {
  test('QualifierOf is the qualifier schema’s output', () => {
    expectTypeOf<QualifierOf<typeof permission>>().toEqualTypeOf<
      ('orders:read' | 'orders:edit')[]
    >();
  });

  test('QualifierOf is undefined for a Guard without a qualifier', () => {
    expectTypeOf<QualifierOf<typeof userToken>>().toEqualTypeOf<undefined>();
  });
});

describe('Attachments typed wider than declarations', () => {
  test('a Guard typed as any Guard skips the Attachment rule, bare or attached', () => {
    const guard: Guard = userToken;

    const listOrders = defineEndpoint({ ...endpoint, guards: [guard, { guard, qualifier: 1 }] });

    expect(listOrders.guards).toHaveLength(2);
  });
});
