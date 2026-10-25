import { defineContract, defineEndpoint, defineGroup } from '@cf-loom/contract';
import { handle, success } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type ServedFault, type ServeOptions, serve } from './index.ts';

const node: z.ZodType = z.object({
  get next() {
    return node.optional();
  },
});

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'A new order',
  input: {
    headers: z.object({ 'x-request-id': z.string() }),
    body: z.object({ email: z.email(), quantity: z.int().min(1), note: z.string().optional() }),
  },
  success: { status: 201, body: z.object({ email: z.string(), quantity: z.int() }) },
});

const deleteOrder = defineEndpoint({
  name: 'deleteOrder',
  method: 'DELETE',
  path: '/orders',
  visibility: 'public',
  description: 'Removes the orders',
  success: { status: 204 },
});

const nest = defineEndpoint({
  name: 'nest',
  method: 'POST',
  path: '/nest',
  visibility: 'public',
  description: 'A deep body',
  input: { body: node },
  success: { status: 204 },
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [createOrder, deleteOrder, nest],
    }),
  ],
});

const handlers = {
  endpoints: {
    createOrder: handle(createOrder, ({ body }) => success(body)),
    deleteOrder: handle(deleteOrder, () => success()),
    nest: handle(nest, () => success()),
  },
  guards: {},
  deprecatedAt: {},
};

const http = serve(contract, handlers);

const order = { email: 'a@example.com', quantity: 2 };
const json = { 'content-type': 'application/json', 'x-request-id': 'r-1' };

function post(
  body: string | Uint8Array<ArrayBuffer> | Blob | null,
  headers: Record<string, string> = json,
): Request {
  return new Request('http://test/orders', { method: 'POST', headers, body });
}

async function issuesOf(response: Response): Promise<unknown> {
  const answered = (await response.json()) as { rejection: { body: { issues: unknown } } };
  return answered.rejection.body.issues;
}

function malformed(message: string) {
  return [{ in: 'body', path: [], code: 'malformed', message }];
}

describe('serve: the body', () => {
  test('a body is parsed as JSON and its Success sent with the declared status', async () => {
    const response = await http(post(JSON.stringify({ ...order, extra: 1 })));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(order);
  });

  test('a body that breaks its schema is invalid input, one Issue per failure', async () => {
    const response = await http(post(JSON.stringify({ email: 'nope', quantity: 0 })));

    expect(response.status).toBe(400);
    expect(await issuesOf(response)).toEqual([
      { in: 'body', path: ['email'], code: 'invalid_format', message: expect.any(String) },
      { in: 'body', path: ['quantity'], code: 'too_small', message: expect.any(String) },
    ]);
  });

  test('a content type with parameters still names JSON', async () => {
    const headers = { ...json, 'content-type': 'application/json; charset=utf-8' };

    const response = await http(post(JSON.stringify(order), headers));

    expect(response.status).toBe(201);
  });

  test('a wrong or missing content type is malformed', async () => {
    const wrong = post(JSON.stringify(order), { ...json, 'content-type': 'text/plain' });
    const missing = post(new Blob([JSON.stringify(order)]), { 'x-request-id': 'r-1' });

    const answers = [await issuesOf(await http(wrong)), await issuesOf(await http(missing))];

    expect(answers).toEqual([
      malformed('The content type is not application/json'),
      malformed('The content type is not application/json'),
    ]);
  });

  test('an empty body, a body that is no JSON and one that is no UTF-8 are malformed', async () => {
    const bodies = [null, '{"email":', new Uint8Array([0x7b, 0xff, 0x7d])];

    const answers = await Promise.all(bodies.map(async (body) => issuesOf(await http(post(body)))));

    expect(answers).toEqual(Array(3).fill(malformed('The body is not JSON')));
  });

  test('a byte that is no UTF-8 inside a JSON string is malformed, never replaced', async () => {
    const encoded = new TextEncoder().encode('{"email":"a@example.com","quantity":2,"note":"x"}');
    const noteAt = encoded.lastIndexOf(0x78);
    encoded[noteAt] = 0xff;

    const response = await http(post(encoded));

    expect(await issuesOf(response)).toEqual(malformed('The body is not JSON'));
  });

  test('a stream that fails after a complete JSON value is malformed', async () => {
    const chunks = [new TextEncoder().encode(JSON.stringify(order))];
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk === undefined) {
          controller.error(new Error('the Caller went away'));
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const request = new Request('http://test/orders', {
      method: 'POST',
      headers: json,
      body: failing,
      duplex: 'half',
    } as RequestInit);

    const response = await http(request);

    expect(await issuesOf(response)).toEqual(malformed('The body is not JSON'));
  });

  test('a body whose stream fails while read is malformed', async () => {
    const failing = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"email":'));
        controller.error(new Error('the Caller went away'));
      },
    });
    const request = new Request('http://test/orders', {
      method: 'POST',
      headers: json,
      body: failing,
      duplex: 'half',
    } as RequestInit);

    const response = await http(request);

    expect(await issuesOf(response)).toEqual(malformed('The body is not JSON'));
  });

  test('a malformed body is answered alone, since the Input cannot be read', async () => {
    const headers = { 'content-type': 'application/json' };

    const response = await http(post('nope', headers));

    expect(await issuesOf(response)).toEqual(malformed('The body is not JSON'));
  });

  test('a body sent to an Endpoint that declares none is not read', async () => {
    const request = new Request('http://test/orders', {
      method: 'DELETE',
      headers: { 'content-type': 'text/plain' },
      body: 'anything',
    });

    const response = await http(request);

    expect(response.status).toBe(204);
    expect(request.bodyUsed).toBe(false);
  });
});

describe('serve: maxBodyBytes', () => {
  const limited = serve(contract, handlers, { maxBodyBytes: 64 });
  const large = JSON.stringify({ ...order, note: 'x'.repeat(100) });

  test('a body larger than maxBodyBytes is BODY_TOO_LARGE, whatever Content-Length says', async () => {
    const response = await limited(post(large, { ...json, 'content-length': '10' }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      fault: {
        code: 'BODY_TOO_LARGE',
        committed: 'no',
        retryable: false,
        message: 'The body is too large',
      },
    });
  });

  test('a body of exactly maxBodyBytes is read, and one byte more is BODY_TOO_LARGE', async () => {
    const exact = JSON.stringify({ ...order, note: '' });
    const atLimit = serve(contract, handlers, { maxBodyBytes: exact.length });

    const statuses = [
      (await atLimit(post(exact))).status,
      (await atLimit(post(JSON.stringify({ ...order, note: 'x' })))).status,
    ];

    expect(statuses).toEqual([201, 413]);
  });

  test('a body within maxBodyBytes is read', async () => {
    const response = await limited(post(JSON.stringify(order)));

    expect(response.status).toBe(201);
  });

  test.each([
    [Number.NaN, 'NaN'],
    [-1, '-1'],
    [1.5, '1.5'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['10', '"10"'],
    [null, 'null'],
  ])('serve refuses a maxBodyBytes of %s at startup, naming it', (maxBodyBytes, named) => {
    const starting = () => serve(contract, handlers, { maxBodyBytes: maxBodyBytes as number });

    expect(starting).toThrow(
      `maxBodyBytes must be a whole number of bytes from 0, or 'unlimited': got ${named}`,
    );
  });

  test('a maxBodyBytes of unlimited reads a body of 2 MB', async () => {
    const unlimited = serve(contract, handlers, { maxBodyBytes: 'unlimited' });

    const response = await unlimited(
      post(JSON.stringify({ ...order, note: 'x'.repeat(2_000_000) })),
    );

    expect(response.status).toBe(201);
  });

  test('a maxBodyBytes of 0 answers BODY_TOO_LARGE to any body that is not empty', async () => {
    const none = serve(contract, handlers, { maxBodyBytes: 0 });

    const response = await none(post(JSON.stringify(order)));

    expect(response.status).toBe(413);
  });

  test('maxBodyBytes takes a number or unlimited, and no other text', () => {
    const unlimited: ServeOptions = { maxBodyBytes: 'unlimited' };
    // @ts-expect-error a number of bytes as text is not a limit
    const text: ServeOptions = { maxBodyBytes: '10' };

    expect([unlimited.maxBodyBytes, text.maxBodyBytes]).toEqual(['unlimited', '10']);
  });

  test('without maxBodyBytes a large body is read', async () => {
    const response = await http(post(JSON.stringify({ ...order, note: 'x'.repeat(1_000_000) })));

    expect(response.status).toBe(201);
  });

  test('a body nested past the stack answers the invalid-input Rejection, malformed at input.body, and no Handler runs', async () => {
    const faults: ServedFault[] = [];
    const ran: string[] = [];
    const nestHandler = handle(nest, () => {
      ran.push('nest');
      return success();
    });
    const watched = serve(
      contract,
      { ...handlers, endpoints: { ...handlers.endpoints, nest: nestHandler } },
      {
        onServiceFault: (fault) => {
          faults.push(fault);
        },
      },
    );
    const deep = `${'{"next":'.repeat(5000)}{}${'}'.repeat(5000)}`;

    const response = await watched(
      new Request('http://test/nest', { method: 'POST', headers: json, body: deep }),
    );

    expect(response.status).toBe(400);
    expect(await issuesOf(response)).toEqual(malformed('The value is nested too deeply to read'));
    expect(faults).toEqual([]);
    expect(ran).toEqual([]);
  });
});
