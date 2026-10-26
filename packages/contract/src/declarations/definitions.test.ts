import * as built from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  notFound,
} from '../index.ts';

describe('defineDefinitions', () => {
  test('guards, schemas and rejections are type errors: what the Root file exports is what a Definitions Package shares', () => {
    // @ts-expect-error: guards is not a declared field
    const guards = defineDefinitions({ guards: [] });
    // @ts-expect-error: schemas is not a declared field
    const schemas = defineDefinitions({ schemas: {} });
    // @ts-expect-error: rejections is not a declared field
    const rejections = defineDefinitions({ rejections: [] });

    expect([guards, schemas, rejections].map(({ kind }) => kind)).toEqual([
      'definitions',
      'definitions',
      'definitions',
    ]);
  });

  test('a name is a type error: the package.json a Definitions Package is published from names it', () => {
    const definitions = defineDefinitions({
      // @ts-expect-error: name is not a declared field
      name: 'definitions',
    });

    expect(definitions.kind).toBe('definitions');
  });

  test('a Definitions Package may declare its Standard Rejections’ codes, statuses and messages', () => {
    const definitions = defineDefinitions({
      standardRejections: {
        invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'Bad request' },
        notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
      },
    });

    expect(definitions.standardRejections.invalidInput.status).toBe(422);
  });

  test('notImplemented’s status must be 501', () => {
    const declare = () =>
      defineDefinitions({
        standardRejections: {
          // @ts-expect-error not implemented is always 501
          notImplemented: { code: 'NOT_IMPLEMENTED', status: 500, message: 'Not implemented' },
        },
      });

    expect(declare).not.toThrow();
  });

  test('invalidInput’s status must be a 4xx', () => {
    const declare = () =>
      defineDefinitions({
        standardRejections: {
          // @ts-expect-error invalid input is a 4xx
          invalidInput: { code: 'BAD_REQUEST', status: 501, message: 'Bad request' },
        },
      });

    expect(declare).not.toThrow();
  });

  test('a Standard Rejection declares no body', () => {
    const declare = () =>
      defineDefinitions({
        standardRejections: {
          notFound: {
            code: 'NOT_FOUND',
            status: 404,
            message: 'Not found',
            // @ts-expect-error cf-loom owns the Standard Rejections' bodies
            body: z.object({ resource: z.string() }),
          },
        },
      });

    expect(declare).not.toThrow();
  });

  test('a Standard Rejection declares no headers', () => {
    const declare = () =>
      defineDefinitions({
        standardRejections: {
          notFound: {
            code: 'NOT_FOUND',
            status: 404,
            message: 'Not found',
            // @ts-expect-error a Standard Rejection answers no declared headers
            headers: z.object({ 'x-resource': z.string() }),
          },
        },
      });

    expect(declare).not.toThrow();
  });
});

describe('defineDefinitions fields', () => {
  test('an undeclared field is a type error', () => {
    const declare = () =>
      // @ts-expect-error a Definitions Package owns no Endpoints
      defineDefinitions({ endpoints: [] });

    expect(declare).not.toThrow();
  });
});

describe('a declared Definitions Package’s containers', () => {
  test('a Definitions Package freezes its Standard Rejections', () => {
    const notFound = { code: 'NOT_FOUND', status: 404, message: 'Not found' } as const;

    const definitions = defineDefinitions({ standardRejections: { notFound } });

    expect(Object.isFrozen(definitions.standardRejections)).toBe(true);
    expect(Object.isFrozen(definitions.standardRejections.notFound)).toBe(true);
  });
});

describe('defineDefinitions nested fields', () => {
  test('an undeclared Standard Rejection is a type error', () => {
    const declare = () =>
      defineDefinitions({
        standardRejections: {
          invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'Bad request' },
          // @ts-expect-error notFund is not a Standard Rejection
          notFund: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
        },
      });

    expect(declare).not.toThrow();
  });

  test('an undeclared field in a Standard Rejection is a type error', () => {
    const declare = () =>
      defineDefinitions({
        standardRejections: {
          notFound: {
            code: 'NOT_FOUND',
            status: 404,
            message: 'Not found',
            // @ts-expect-error detail is not a field of a Standard Rejection
            detail: 'More',
          },
        },
      });

    expect(declare).not.toThrow();
  });
});

describe('a Definitions Package with containers the author froze', () => {
  test('an author-frozen standardRejections still gets frozen entries', () => {
    const standardRejections = Object.freeze({
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' } as const,
    });

    const definitions = defineDefinitions({ standardRejections });

    expect(Object.isFrozen(definitions.standardRejections.notFound)).toBe(true);
  });
});

describe('declarations from another copy of @cf-loom/contract', () => {
  const ordersBody = z.array(z.object({ id: z.uuid() }));

  test('a Group keeps an Endpoint declared by another copy', () => {
    const listOrders = built.defineEndpoint({
      name: 'listOrders',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'Every order',
      success: { status: 200, body: ordersBody },
    });

    const ordersGroup = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      endpoints: [listOrders],
    });

    expect(ordersGroup.endpoints[0]).toBe(listOrders);
  });

  test('another copy’s Group keeps an Endpoint declared by this copy', () => {
    const listOrders = defineEndpoint({
      name: 'listOrders',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'Every order',
      success: { status: 200, body: ordersBody },
    });

    const ordersGroup = built.defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      endpoints: [listOrders],
    });

    expect(ordersGroup.endpoints[0]).toBe(listOrders);
  });

  test('an Endpoint keeps a Standard Rejection from another copy', () => {
    const getOrder = defineEndpoint({
      name: 'getOrder',
      method: 'GET',
      path: '/orders/latest',
      visibility: 'public',
      description: 'The latest order',
      success: { status: 200, body: ordersBody },
      rejections: [built.notFound],
    });

    expect(built.notFound).not.toBe(notFound);
    expect(getOrder.rejections[0]).toBe(built.notFound);
  });

  test('an unbranded plain object with a kind is copied', () => {
    const forbidden = {
      code: 'FORBIDDEN',
      status: 403,
      message: 'Forbidden',
      kind: 'rejection',
    } as const;

    const guard = defineGuard({ name: 'admin', description: 'An admin', rejections: [forbidden] });

    expect(guard.rejections[0]).not.toBe(forbidden);
    expect(guard.rejections[0]).toEqual(forbidden);
  });

  test('a declaration shows no brand in its keys or its JSON', () => {
    const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

    expect(Object.keys(forbidden)).toEqual(['code', 'status', 'message', 'kind']);
    expect(JSON.parse(JSON.stringify(forbidden))).toEqual({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Forbidden',
      kind: 'rejection',
    });
  });
});
