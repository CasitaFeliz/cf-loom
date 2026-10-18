import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineEndpoint,
  defineGuard,
  defineRejection,
  invalidInput,
  notFound,
  notImplemented,
} from '../index.ts';
import { answerableRejectionsOf, schemaOf } from '../internal/index.ts';

const unauthenticated = defineRejection({
  code: 'UNAUTH',
  status: 401,
  message: 'Unauthenticated',
});
const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
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
