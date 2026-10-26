import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineEndpoint,
  defineGuard,
  defineRejection,
  defineService,
  invalidInput,
  notFound,
  notImplemented,
} from '../index.ts';
import {
  answerableByCodeOf,
  answerableRejectionsOf,
  contextProvidersOf,
  declaredByCodeOf,
  resolutionOf,
  schemaOf,
  standardRejectionsOf,
} from '../internal/index.ts';

const unauthenticated = defineRejection({
  code: 'UNAUTH',
  status: 401,
  message: 'Unauthenticated',
});
const standardRejectionDefaults = standardRejectionsOf(
  defineService({ name: 'orders-service', groups: [] }),
);

const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  rejections: [unauthenticated],
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'The latest order',
  guards: [apiKey],
  success: { status: 200, body: z.object({ id: z.string() }) },
  rejections: [notFound, forbidden],
});

describe('answerableRejectionsOf', () => {
  test('an Endpoint answers its own Rejections, its Guards’ and the two the runtime adds', () => {
    const answerable = answerableRejectionsOf(getOrder);

    expect(answerable).toEqual([
      notFound,
      forbidden,
      unauthenticated,
      invalidInput,
      notImplemented,
    ]);
  });

  test('a Rejection reached by several paths is listed once', () => {
    const userToken = defineGuard({
      name: 'userToken',
      description: 'A signed-in user',
      rejections: [unauthenticated],
    });
    const listedTwice = defineEndpoint({
      name: 'listedTwice',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'The latest order',
      guards: [apiKey, userToken],
      success: { status: 200, body: z.object({ id: z.string() }) },
      rejections: [unauthenticated, notFound],
    });

    const answerable = answerableRejectionsOf(listedTwice);

    expect(answerable).toEqual([unauthenticated, notFound, invalidInput, notImplemented]);
  });

  test('a Guard answers its own Rejections and the not-implemented one', () => {
    const answerable = answerableRejectionsOf(apiKey);

    expect(answerable).toEqual([unauthenticated, notImplemented]);
  });
});

describe('answerableByCodeOf', () => {
  test('each Rejection an Endpoint answers is found by its resolved code', () => {
    const standards = {
      ...standardRejectionDefaults,
      notFound: { code: 'NO_ORDER', status: 404, message: 'No order' } as const,
    };

    const byCode = answerableByCodeOf(getOrder, standards);

    expect([...byCode.keys()]).toEqual([
      'NO_ORDER',
      'FORBIDDEN',
      'UNAUTH',
      'INVALID_INPUT',
      'NOT_IMPLEMENTED',
    ]);
    expect(byCode.get('NO_ORDER')).toBe(notFound);
  });
});

describe('declaredByCodeOf', () => {
  test('every Standard Rejection and every Rejection the Endpoints answer are found by resolved code', () => {
    const standards = {
      ...standardRejectionDefaults,
      notFound: { code: 'NO_ORDER', status: 404, message: 'No order' } as const,
    };
    const listOrders = defineEndpoint({
      name: 'listOrders',
      method: 'GET',
      path: '/orders/all',
      visibility: 'public',
      description: 'Every order',
      success: { status: 200, body: z.array(z.string()) },
    });

    const byCode = declaredByCodeOf([listOrders, getOrder], standards);

    expect([...byCode.keys()].sort()).toEqual([
      'FORBIDDEN',
      'INVALID_INPUT',
      'NOT_IMPLEMENTED',
      'NO_ORDER',
      'UNAUTH',
    ]);
    expect(byCode.get('NO_ORDER')).toBe(notFound);
  });

  test('the Standard not-found code is found though no Endpoint lists it', () => {
    const listOrders = defineEndpoint({
      name: 'listOrders',
      method: 'GET',
      path: '/orders/all',
      visibility: 'public',
      description: 'Every order',
      success: { status: 200, body: z.array(z.string()) },
    });

    const byCode = declaredByCodeOf([listOrders], standardRejectionDefaults);

    expect(byCode.get('NOT_FOUND')).toBe(notFound);
  });
});

describe('resolutionOf', () => {
  test('a declared Rejection resolves to its own code, status and message', () => {
    const resolution = resolutionOf(forbidden, standardRejectionDefaults);

    expect(resolution).toEqual({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
  });

  test('a Standard Rejection resolves to the code, status and message the Root resolved', () => {
    const standards = {
      ...standardRejectionDefaults,
      notFound: { code: 'MISSING', status: 404, message: 'Missing' },
    } as const;

    const resolutions = [resolutionOf(notFound, standards), resolutionOf(invalidInput, standards)];

    expect(resolutions).toEqual([
      { code: 'MISSING', status: 404, message: 'Missing' },
      { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    ]);
  });
});

describe('schemaOf', () => {
  test('the schema an Endpoint or a Guard declares at a part, nothing where it declares none', () => {
    const schemas = [
      schemaOf(getOrder, 'success.body'),
      schemaOf(getOrder, 'input.params'),
      schemaOf(apiKey, 'demands.headers'),
      schemaOf(apiKey, 'context'),
    ];

    expect(schemas).toEqual([getOrder.success.body, undefined, apiKey.demands.headers, undefined]);
  });
});

describe('contextProvidersOf', () => {
  test('the Guards that provide a Context to an Endpoint, or to a Guard that lists them', () => {
    const userToken = defineGuard({
      name: 'userToken',
      description: 'A signed-in user',
      context: z.object({ userId: z.string() }),
    });
    const permission = defineGuard({
      name: 'permission',
      description: 'A permission',
      guards: [apiKey, userToken],
    });
    const editOrder = defineEndpoint({
      name: 'editOrder',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'The latest order',
      guards: [apiKey, userToken, permission],
      success: { status: 200, body: z.object({ id: z.string() }) },
    });

    const providers = [contextProvidersOf(editOrder), contextProvidersOf(permission)];

    expect(providers).toEqual([[userToken], [userToken]]);
  });
});
