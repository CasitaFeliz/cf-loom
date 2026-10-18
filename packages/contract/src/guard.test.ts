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
  test('a Guard demands only headers and query', () => {
    const declare = () => [
      defineGuard({
        name: 'paged',
        description: 'A page of results',
        demands: { query: z.object({ page: z.int() }) },
      }),
      defineGuard({
        name: 'signed',
        description: 'A signed body',
        // @ts-expect-error a Guard never demands the body
        demands: { body: z.object({ signature: z.string() }) },
      }),
      defineGuard({
        name: 'tenant',
        description: 'A tenant in the path',
        // @ts-expect-error a Guard never demands path params
        demands: { params: z.object({ tenantId: z.string() }) },
      }),
    ];

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

  test('a Guard’s Context type is inferred from its context schema', () => {
    expectTypeOf<ContextOf<typeof apiKey>>().toEqualTypeOf<{ clientId: string }>();
    expectTypeOf<ContextOf<typeof internalOnly>>().toEqualTypeOf<undefined>();
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
