import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import { defineEndpoint, defineGroup, defineService, type Endpoint } from '../index.ts';
import { type Root, validateRoot } from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

const listOrders = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

/** The result of validating one Endpoint, written with a cast where the types refuse it. */
function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(defineService({ name: 'orders-service', groups: [orders] }));
}

/** A path failure of the Endpoint of that identity: a path that is not canonical still has one. */
function failedPath(identity: string, message: string, rule = 'canonical-path') {
  return failedAt(`endpoints.${identity} (listOrders) path`, rule, message);
}

function failedAt(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

describe('validateRoot: canonical paths', () => {
  test('a canonical path with literal and param segments validates', () => {
    const getItem = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId/items/:itemId',
      input: { params: z.object({ orderId: z.uuid(), itemId: z.int() }) },
    });

    expect(validateEndpoint(getItem).kind).toBe('valid');
  });

  test('the root path validates', () => {
    expect(validateEndpoint(defineEndpoint({ ...listOrders, path: '/' })).kind).toBe('valid');
  });

  test('a path typed wider than a literal is checked like a literal one', () => {
    const path: string = '/orders/:orderId';

    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path }));

    expect(validated).toEqual(
      failedAt(
        'endpoints.GET /orders/{} (listOrders) input.params',
        'exact-params',
        "params declares exactly the path's :names: orderId",
      ),
    );
  });

  test('a path without a leading slash fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: 'orders' }));

    expect(validated).toEqual(failedPath('GET /orders', 'A path starts with /: "orders"'));
  });

  test('a path with a trailing slash fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders/' }));

    expect(validated).toEqual(
      failedPath('GET /orders', 'A path has no trailing slash: "/orders/"'),
    );
  });

  test('a path with an empty segment fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders//latest' }));

    expect(validated).toEqual(
      failedPath('GET /orders//latest', 'A path has no empty segment: "/orders//latest"'),
    );
  });

  test('a path with an upper-case letter fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/Orders' }));

    expect(validated).toEqual(
      failedPath(
        'GET /Orders',
        'A path segment is lower-case letters, digits and dashes: "Orders"',
      ),
    );
  });

  test('a path with a dot, percent-encoding or a query fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders.json' }));

    expect(validated).toEqual(
      failedPath(
        'GET /orders.json',
        'A path segment is lower-case letters, digits and dashes: "orders.json"',
      ),
    );
  });

  test('a param that is not a whole segment fails', () => {
    const validated = validateEndpoint(defineEndpoint({ ...listOrders, path: '/orders/id-:id' }));

    expect(validated).toEqual(
      failedPath(
        'GET /orders/id-:id',
        'A path segment is lower-case letters, digits and dashes: "id-:id"',
      ),
    );
  });

  test('a param with a dot fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/files/:file.json',
        input: { params: z.object({ 'file.json': z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath('GET /files/{}', 'A path param is written :camelCase: ":file.json"'),
    );
  });

  test('an empty param fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/orders/:',
        input: { params: z.object({ '': z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath('GET /orders/{}', 'A path param is written :camelCase: ":"'),
    );
  });

  test('a param written in PascalCase fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/orders/:OrderId',
        // biome-ignore lint/style/useNamingConvention: the param under test is PascalCase
        input: { params: z.object({ OrderId: z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath('GET /orders/{}', 'A path param is written :camelCase: ":OrderId"'),
    );
  });

  test('a path with the same param twice fails', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: '/orders/:id/items/:id',
        input: { params: z.object({ id: z.string() }) },
      }),
    );

    expect(validated).toEqual(
      failedPath(
        'GET /orders/{}/items/{}',
        'A path param appears once: ":id"',
        'duplicate-path-param',
      ),
    );
  });

  test('every way a path breaks the grammar is named, and params are not judged against it', () => {
    const validated = validateEndpoint(
      defineEndpoint({
        ...listOrders,
        path: 'Orders/:id/',
        input: { params: z.object({ id: z.string() }) },
      }),
    );

    const pathAt = 'endpoints.GET /Orders/{} (listOrders) path';
    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: pathAt,
          rule: 'canonical-path',
          message: 'A path starts with /: "Orders/:id/"',
        },
        {
          kind: 'declaration',
          location: pathAt,
          rule: 'canonical-path',
          message: 'A path has no trailing slash: "Orders/:id/"',
        },
        {
          kind: 'declaration',
          location: pathAt,
          rule: 'canonical-path',
          message: 'A path segment is lower-case letters, digits and dashes: "Orders"',
        },
      ],
    });
  });
});

describe('validateRoot: params against the path', () => {
  const paramsAt = 'endpoints.GET /orders/{} (listOrders) input.params';

  test('params with exactly the path’s :names validate', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid() }) },
    });

    expect(validateEndpoint(getOrder).kind).toBe('valid');
  });

  test('a path’s :name missing from params fails', () => {
    const params = z.object({ orderId: z.uuid() }) as z.ZodObject<{
      orderId: z.ZodUUID;
      itemId: z.ZodInt;
    }>;
    const getItem = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId/items/:itemId',
      input: { params },
    });

    expect(validateEndpoint(getItem)).toEqual(
      failedAt(
        'endpoints.GET /orders/{}/items/{} (listOrders) input.params',
        'exact-params',
        "params declares exactly the path's :names: orderId and itemId",
      ),
    );
  });

  test('a param that is not a :name of the path fails', () => {
    const params = z.object({ orderId: z.uuid(), id: z.uuid() }) as z.ZodObject<{
      orderId: z.ZodUUID;
    }>;
    const getOrder = defineEndpoint({ ...listOrders, path: '/orders/:orderId', input: { params } });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'exact-params', "params declares exactly the path's :names: orderId"),
    );
  });

  test('a path with :names and no params fails', () => {
    const getOrder = defineEndpoint({ ...listOrders, path: '/orders/:orderId' as string });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'exact-params', "params declares exactly the path's :names: orderId"),
    );
  });

  test('params on a path without :names fail', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders' as string,
      input: { params: z.object({ orderId: z.uuid() }) },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(
        'endpoints.GET /orders (listOrders) input.params',
        'exact-params',
        'A path without :names takes no params',
      ),
    );
  });

  test('an optional path param fails', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: z.object({ orderId: z.uuid().optional() }) },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(
        `${paramsAt}.orderId`,
        'optional-path-param',
        'A path param is never optional: orderId',
      ),
    );
  });

  test('params that are not an object fail once, as a part that is no object', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: z.string() as unknown as z.ZodObject<{ orderId: z.ZodUUID }> },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'not-an-object-schema', 'params is an object of its fields'),
    );
  });

  test('an input that is a list fails once, as no object', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: [] as unknown as { params: z.ZodObject<{ orderId: z.ZodUUID }> },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(
        'endpoints.GET /orders/{} (listOrders) input',
        'not-an-object',
        'input is an object',
      ),
    );
  });

  test('params that are no schema fail once, as a slot with no schema', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: 'orderId' as unknown as z.ZodObject<{ orderId: z.ZodUUID }> },
    });

    expect(validateEndpoint(getOrder)).toEqual(
      failedAt(paramsAt, 'not-a-schema', 'params is not a zod schema'),
    );
  });
});

describe('validateRoot: params beside a schema that fails', () => {
  /** An object the types refuse, as a cast lets an author write it. */
  const headersOf = (shape: Record<string, z.ZodType>) =>
    z.object(shape) as unknown as z.ZodObject<{ orderId: z.ZodUUID }>;
  const paramsAt = 'endpoints.GET /orders/{} (listOrders) input.params';
  const dateRefusal = (location: string) => ({
    kind: 'not-allowed',
    location,
    construct: 'z.date()',
    instead: 'z.iso.datetime()',
    alsoIn: [],
  });

  test('a path param that is an object holding a date tells that it is no text, and the date', () => {
    const getOrder = defineEndpoint({
      ...listOrders,
      path: '/orders/:orderId',
      input: { params: headersOf({ orderId: z.object({ placedAt: z.date() }) }) },
    });

    expect(validateEndpoint(getOrder)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: `${paramsAt}.orderId`,
          rule: 'not-text',
          message:
            'A path param travels as text: a string, number, boolean, literal or enum: orderId',
        },
        dateRefusal(`${paramsAt}.orderId.placedAt`),
      ],
    });
  });

  test('a param that is not a :name of the path, beside a date, tells both', () => {
    const params = z.object({
      orderId: z.uuid(),
      extra: z.string(),
      placedAt: z.date(),
    }) as z.ZodObject<{
      orderId: z.ZodUUID;
    }>;
    const getOrder = defineEndpoint({ ...listOrders, path: '/orders/:orderId', input: { params } });

    expect(validateEndpoint(getOrder)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: paramsAt,
          rule: 'exact-params',
          message: "params declares exactly the path's :names: orderId",
        },
        dateRefusal(`${paramsAt}.placedAt`),
      ],
    });
  });

  test('params that are nullable and whose kind is not built tell that they are never nullable, and the date', () => {
    const params = z.date().nullable() as unknown as z.ZodObject<{ orderId: z.ZodUUID }>;
    const getOrder = defineEndpoint({ ...listOrders, path: '/orders/:orderId', input: { params } });

    expect(validateEndpoint(getOrder)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: paramsAt,
          rule: 'nullable-text',
          message: 'params is never nullable',
        },
        dateRefusal(paramsAt),
      ],
    });
  });

  test('an object holding a field named constructor tells that name alone, since it is unbuilt', () => {
    const params = headersOf({ orderId: z.uuid(), constructor: z.string() });
    const getOrder = defineEndpoint({ ...listOrders, path: '/orders/:orderId', input: { params } });

    const validated = validateEndpoint(getOrder);

    expect(validated.kind === 'invalid' ? validated.failures.map(({ kind }) => kind) : []).toEqual([
      'not-allowed',
    ]);
  });
});
