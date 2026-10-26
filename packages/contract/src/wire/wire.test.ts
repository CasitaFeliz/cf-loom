import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import type { ReservedCode } from '../index.ts';
import {
  allowedMethodsOf,
  bodyOf,
  committedValues,
  deprecatedAtOfHeader,
  faultResponseOf,
  faultStatusOf,
  headerTextsOf,
  headerValuesOf,
  invalidInputBodyOf,
  invalidInputResponseOf,
  isQueryText,
  isReservedCode,
  isSegmentText,
  jsonBytesOf,
  jsonContentType,
  jsonMediaType,
  jsonOfBytes,
  malformedBodyIssueOf,
  pathSegmentsOf,
  receivedBodyOf,
  receivedEnvelopeOf,
  rejectionResponseOf,
  reservedFaults,
  reservedResponseOf,
  type SchemaNode,
  segmentOf,
  successResponseOf,
  type TextPartNodes,
  textOfValue,
  textPartsOf,
  withDeprecation,
} from '../internal/index.ts';

const number: SchemaNode = { type: 'number' };
const boolean: SchemaNode = { type: 'boolean' };
const string: SchemaNode = { type: 'string' };

/** What a request's query carries under one field once its node reads the texts sent for it. */
function queryValueOf(node: SchemaNode, texts: readonly string[]): unknown {
  const nodes: TextPartNodes = {
    'input.query': {
      type: 'object',
      fields: { v: { required: true, schema: node } },
    },
  };
  const source = {
    params: {},
    query: new URLSearchParams(texts.map((text): [string, string] => ['v', text])),
    headers: new Headers(),
  };

  const { query = {} } = textPartsOf(nodes, source);

  return Object.values(query)[0];
}

/** What `bodyOf` makes of a request with an empty JSON object, sent with this content type. */
async function bodyKindOf(contentType: string | null): Promise<string> {
  const request = new Request('http://test/', {
    method: 'POST',
    headers: contentType === null ? {} : { 'content-type': contentType },
    body: new TextEncoder().encode('{}'),
  });

  return (await bodyOf(request, Number.POSITIVE_INFINITY)).kind;
}

/** Whether a header value can travel: `texts` when it can, `issues` when it cannot. */
function headerKindOf(text: string): 'texts' | 'issues' {
  return headerTextsOf('success.headers', { 'x-v': text }).kind;
}

describe('textPartsOf, a text as its node reads it', () => {
  test('a number matching the pattern is converted, any other text is kept for the schema to refuse', () => {
    const texts = ['0', '-12', '3.25', '01', '1.', 'abc', '1e3', '+1'];

    const values = texts.map((text) => queryValueOf(number, [text]));

    expect(values).toEqual([0, -12, 3.25, '01', '1.', 'abc', '1e3', '+1']);
  });

  test('a boolean is exactly true or false', () => {
    const texts = ['true', 'false', 'TRUE', 'FALSE', '1', '0'];

    const values = texts.map((text) => queryValueOf(boolean, [text]));

    expect(values).toEqual([true, false, 'TRUE', 'FALSE', '1', '0']);
  });

  test('a literal and an enum take their declared value by its text, a numeric one included', () => {
    const literal: SchemaNode = { type: 'enum', values: [5], open: false };
    const choices: SchemaNode = { type: 'enum', values: ['web', 'phone'], open: false };

    const values = [
      queryValueOf(literal, ['5']),
      queryValueOf(literal, ['6']),
      queryValueOf(choices, ['phone']),
      queryValueOf(choices, ['fax']),
    ];

    expect(values).toEqual([5, '6', 'phone', 'fax']);
  });

  test('a string is kept unchanged', () => {
    const value = queryValueOf(string, [' 42 ']);

    expect(value).toBe(' 42 ');
  });

  test('a list converts each occurrence by its items, one occurrence a one-item list', () => {
    const list: SchemaNode = { type: 'array', items: number };

    const values = [queryValueOf(list, ['1', '2']), queryValueOf(list, ['7'])];

    expect(values).toEqual([[1, 2], [7]]);
  });

  test('a single node given several texts keeps the list, for its schema to refuse', () => {
    const value = queryValueOf(number, ['1', '2']);

    expect(value).toEqual(['1', '2']);
  });
});

describe('textOfValue and headerTextsOf', () => {
  test('a value travels as the text JavaScript writes it', () => {
    expect([textOfValue(3), textOfValue(-1.5), textOfValue(true), textOfValue('v1')]).toEqual([
      '3',
      '-1.5',
      'true',
      'v1',
    ]);
  });

  test('a number travels as plain decimal, never in exponent form, and reads back as itself', () => {
    const numbers = [1e21, 1.5e-7, -2.5e-10, 1.23e25, 0.1, -0, 123456.789, 5e-324];

    const texts = numbers.map(textOfValue);

    expect(texts.slice(0, 4)).toEqual([
      '1000000000000000000000',
      '0.00000015',
      '-0.00000000025',
      '12300000000000000000000000',
    ]);
    expect(texts.every((text) => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(text))).toBe(true);
    expect(texts.map((text) => queryValueOf(number, [text]))).toEqual(numbers.map((n) => n + 0));
  });

  test('a number that is not finite cannot travel, a bug', () => {
    const notFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const value of notFinite) {
      expect(() => textOfValue(value)).toThrow(/finite/);
    }
  });

  test('a header value is RFC 9110 field text: tab, visible ASCII, space and U+0080 to U+00FF', () => {
    const accepted = ['v1', 'a, b', 'café', '\u00ff', '', 'a\tb', '\u0080', 'a b'];
    const refused = [
      '€',
      '\u0100',
      'a\nb',
      'a\rb',
      'a\u0000b',
      'a\u0001b',
      'a\u001fb',
      'a\u007fb',
      '😀',
    ];

    expect(accepted.map(headerKindOf)).toEqual(Array(accepted.length).fill('texts'));
    expect(refused.map(headerKindOf)).toEqual(Array(refused.length).fill('issues'));
  });

  test('a header value has no leading or trailing whitespace', () => {
    const refused = [' a', 'a ', '\ta', 'a\t', '   '];

    expect(refused.map(headerKindOf)).toEqual(Array(refused.length).fill('issues'));
  });

  test('a Success’s headers travel as text, an undefined one left out', () => {
    const sent = headerTextsOf('success.headers', {
      'x-total': 3,
      'x-ok': true,
      etag: 'v1',
      'x-none': undefined,
    });

    expect(sent).toEqual({
      kind: 'texts',
      texts: [
        ['x-total', '3'],
        ['x-ok', 'true'],
        ['etag', 'v1'],
      ],
    });
  });

  test('a Success header that cannot travel is an Issue at success.headers, by its name', () => {
    const sent = headerTextsOf('success.headers', { etag: ' v1', 'x-total': 3, 'x-list': ['a'] });

    expect(sent).toEqual({
      kind: 'issues',
      issues: [
        {
          part: 'success.headers',
          path: ['etag'],
          code: 'invalid_format',
          message: expect.any(String),
        },
        {
          part: 'success.headers',
          path: ['x-list'],
          code: 'invalid_format',
          message: expect.any(String),
        },
      ],
    });
  });

  test('an Input header that cannot travel is an Issue at input.headers, by its name', () => {
    const sent = headerTextsOf('input.headers', { 'x-api-key': 'a\nb', 'x-id': 'ok' });

    expect(sent).toEqual({
      kind: 'issues',
      issues: [
        {
          part: 'input.headers',
          path: ['x-api-key'],
          code: 'invalid_format',
          message: 'The header value cannot travel as HTTP field text',
        },
      ],
    });
  });
});

describe('the Envelopes as they travel', () => {
  test('a Rejection without a body travels with no body key', async () => {
    const response = rejectionResponseOf({ code: 'NOT_FOUND', status: 404, message: 'Not found' });

    const envelope = await response.json();

    expect(envelope).toStrictEqual({ rejection: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  test('a Rejection with a body carries it', async () => {
    const body = { lockedAt: '2026-10-18T10:00:00Z' };
    const response = rejectionResponseOf({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      body,
    });

    const envelope = await response.json();

    expect(envelope).toStrictEqual({
      rejection: { code: 'ORDER_LOCKED', message: 'Locked', body },
    });
  });

  test('rejectionResponseOf sends each header value as its text, one left undefined unsent, beside its Envelope', async () => {
    const response = rejectionResponseOf({
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Unauthenticated',
      headers: {
        'www-authenticate': 'Bearer realm="orders"',
        'retry-after': 30,
        'x-note': undefined,
      },
    });

    expect(response.status).toBe(401);
    expect([...response.headers]).toEqual([
      ['content-type', jsonContentType],
      ['retry-after', '30'],
      ['www-authenticate', 'Bearer realm="orders"'],
    ]);
    expect(await response.json()).toStrictEqual({
      rejection: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' },
    });
  });

  test('a Rejection’s header that cannot travel is thrown, as a bug of the check before it', () => {
    const send = () =>
      rejectionResponseOf({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Unauthenticated',
        headers: { 'www-authenticate': 'Bearer\nrealm' },
      });

    expect(send).toThrow(
      'A Rejection header that cannot travel was not checked before it was sent: www-authenticate',
    );
  });

  test('a reserved Fault carries its code, a Handler’s Fault none', async () => {
    const reserved = reservedResponseOf('RETIRED');
    const returned = faultResponseOf({ committed: 'yes', retryable: true, message: 'Lost' });

    const envelopes = [await reserved.json(), await returned.json()];

    expect(envelopes).toStrictEqual([
      {
        fault: {
          code: 'RETIRED',
          committed: 'no',
          retryable: false,
          message: 'The Endpoint is retired',
        },
      },
      { fault: { committed: 'yes', retryable: true, message: 'Lost' } },
    ]);
  });

  test('faultResponseOf sends only committed, retryable and message; a code given beside them never travels', async () => {
    const forged = {
      code: 'RETIRED',
      committed: 'no',
      retryable: false,
      message: 'Forged',
    } as const;

    const response = faultResponseOf(forged);

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      fault: { committed: 'no', retryable: false, message: 'Forged' },
    });
  });

  test('successResponseOf sends each header value as its text, one left undefined unsent', async () => {
    const response = successResponseOf({
      status: 200,
      headers: { 'x-total': 3, etag: 'v1', 'x-note': undefined },
      body: { id: 'o-1' },
    });

    expect(response.status).toBe(200);
    expect([...response.headers]).toEqual([
      ['content-type', jsonContentType],
      ['etag', 'v1'],
      ['x-total', '3'],
    ]);
    expect(await response.json()).toEqual({ id: 'o-1' });
  });
});

describe('allowedMethodsOf', () => {
  test('lists the methods declared Endpoints take on a request’s path, literal and param, once each in code point order', () => {
    const declared = [
      ['POST', '/orders/:orderId'],
      ['GET', '/orders/summary'],
      ['GET', '/orders/:orderId'],
      ['DELETE', '/orders/:orderId'],
      ['PUT', '/items/:itemId'],
    ].map(([method = '', path = '']) => ({ method, segments: pathSegmentsOf(path) }));

    const allowed = [
      allowedMethodsOf(declared, new Request('http://test/orders/summary', { method: 'PATCH' })),
      allowedMethodsOf(declared, new Request('http://test/customers')),
    ];

    expect(allowed).toEqual([['DELETE', 'GET', 'POST'], []]);
  });
});

describe('the reserved codes and statuses', () => {
  test('each reserved code has the status and committed Over HTTP lists', () => {
    expect(Object.entries(reservedFaults)).toEqual([
      ['RETIRED', { status: 410, committed: 'no', message: 'The Endpoint is retired' }],
      [
        'NO_SUCH_ENDPOINT',
        { status: 404, committed: 'no', message: 'No Endpoint has this method and path' },
      ],
      [
        'METHOD_NOT_ALLOWED',
        { status: 405, committed: 'no', message: 'No Endpoint has this method on this path' },
      ],
      ['BODY_TOO_LARGE', { status: 413, committed: 'no', message: 'The body is too large' }],
      [
        'INVALID_OUTCOME',
        { status: 500, committed: 'unknown', message: 'The Outcome broke the Contract' },
      ],
    ]);
  });

  test('a reserved code is one of the five, any other value is none', () => {
    const values = ['RETIRED', 'INVALID_OUTCOME', 'NOT_FOUND', 'retired', 1, undefined];

    expect(values.map(isReservedCode)).toEqual([true, true, false, false, false, false]);
  });

  test('every reserved code a declaration may not take has its row', () => {
    expectTypeOf<keyof typeof reservedFaults>().toEqualTypeOf<ReservedCode>();
  });

  test('a Fault travels with its reserved code’s status, else 503 when retryable and 500 otherwise', () => {
    const responses = [
      reservedResponseOf('BODY_TOO_LARGE'),
      faultResponseOf({ committed: 'unknown', retryable: true, message: 'Down' }),
      faultResponseOf({ committed: 'unknown', retryable: false, message: 'Broke' }),
    ];

    const statuses = responses.map((response) => response.status);

    expect(statuses).toEqual([413, 503, 500]);
  });

  test('a Fault the Service produced has the status 503 when it is retryable and 500 otherwise', () => {
    const statuses = [faultStatusOf({ retryable: true }), faultStatusOf({ retryable: false })];

    expect(statuses).toEqual([503, 500]);
  });

  test('committed is no, yes or unknown', () => {
    expect(committedValues).toEqual(['no', 'yes', 'unknown']);
  });
});

describe('the content type', () => {
  test('bodies are JSON, sent as UTF-8', () => {
    expect([jsonMediaType, jsonContentType]).toEqual([
      'application/json',
      'application/json; charset=utf-8',
    ]);
  });

  test('a request names JSON by its media type, whatever its parameters or case', async () => {
    const accepted = [
      'application/json',
      'application/json; charset=utf-8',
      'Application/JSON ;x=1',
    ];
    const refused = ['text/plain', 'application/jsonx', 'application/problem+json', '', null];

    const acceptedBodies = await Promise.all(accepted.map(bodyKindOf));
    const refusedBodies = await Promise.all(refused.map(bodyKindOf));

    expect(acceptedBodies).toEqual(['value', 'value', 'value']);
    expect(refusedBodies).toEqual([
      'malformed',
      'malformed',
      'malformed',
      'malformed',
      'malformed',
    ]);
  });
});

describe('bodyOf', () => {
  test('a body sent with another content type is malformed', async () => {
    const request = new Request('http://test/', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });

    const body = await bodyOf(request, Number.POSITIVE_INFINITY);

    expect(body).toEqual({
      kind: 'malformed',
      message: 'The content type is not application/json',
    });
  });

  test('a body that is no JSON is malformed', async () => {
    const request = new Request('http://test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const body = await bodyOf(request, Number.POSITIVE_INFINITY);

    expect(body).toEqual({ kind: 'malformed', message: 'The body is not JSON' });
  });
});

describe('bodyOf, reading a Response', () => {
  test('a JSON Response body is read as its value', async () => {
    const response = Response.json({ id: 'o-1' });

    const body = await bodyOf(response, Number.POSITIVE_INFINITY);

    expect(body).toEqual({ kind: 'value', value: { id: 'o-1' } });
  });

  test('a body whose stream fails while it is read is unreadable, with the error, told from no JSON', async () => {
    const failure = new Error('socket hang up');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
        controller.error(failure);
      },
    });
    const response = new Response(stream, { headers: { 'content-type': 'application/json' } });

    const body = await bodyOf(response, Number.POSITIVE_INFINITY);

    expect(body).toMatchObject({
      kind: 'unreadable',
      error: failure,
      message: 'The body is not JSON',
    });
  });
});

describe('the Deprecation header', () => {
  test('a deprecatedAt is sent as @ and its unix seconds', () => {
    const response = withDeprecation(new Response(null), '2026-10-17T09:30:00Z');

    expect(response.headers.get('deprecation')).toBe('@1792229400');
  });

  test('a received Deprecation header is read back as the instant, and anything else as none', () => {
    const headers = ['@1792229400', '1792229400', '@soon', '@1.5', ''];

    const instants = headers.map(deprecatedAtOfHeader);

    expect(instants).toEqual(['2026-10-17T09:30:00Z', undefined, undefined, undefined, undefined]);
  });
});

describe('the invalid-input body', () => {
  test('each Issue says the part of the request it read, its path, code and message', () => {
    const issues = [
      { part: 'input.params', path: ['orderId'], code: 'invalid_format', message: 'Invalid UUID' },
      { part: 'demands.headers', path: ['x-api-key'], code: 'required', message: 'Required' },
      { part: 'input.body', path: [], code: 'malformed', message: 'The body is not JSON' },
    ] as const;

    const body = invalidInputBodyOf(issues);

    expect(body).toEqual({
      issues: [
        { in: 'params', path: ['orderId'], code: 'invalid_format', message: 'Invalid UUID' },
        { in: 'headers', path: ['x-api-key'], code: 'required', message: 'Required' },
        { in: 'body', path: [], code: 'malformed', message: 'The body is not JSON' },
      ],
    });
  });

  test('each part of the request an Issue sits in is named by its in', () => {
    const parts = [
      'input.params',
      'input.query',
      'input.headers',
      'input.body',
      'demands.query',
      'demands.headers',
    ] as const;
    const issues = parts.map((part) => ({
      part,
      path: [],
      code: 'required' as const,
      message: 'Required',
    }));

    const body = invalidInputBodyOf(issues);

    expect(body.issues.map((issue) => issue.in)).toEqual([
      'params',
      'query',
      'headers',
      'body',
      'query',
      'headers',
    ]);
  });
});

describe('the invalid-input Rejection', () => {
  test('it answers the resolved code, status and message with cf-loom’s body', async () => {
    const standards = {
      invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
    } as const;
    const issues = [
      { part: 'input.query', path: ['page'], code: 'invalid_type', message: 'A number' },
    ] as const;

    const response = invalidInputResponseOf(issues, standards);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      rejection: {
        code: 'BAD_REQUEST',
        message: 'The request is invalid',
        body: {
          issues: [{ in: 'query', path: ['page'], code: 'invalid_type', message: 'A number' }],
        },
      },
    });
  });
});

describe('the invalid-input Rejection of a Provider whose Standard Rejections carry a Reader', () => {
  test('it answers cf-loom’s body of the Issues, never the Reader', async () => {
    const standards = {
      invalidInput: {
        code: 'BAD_REQUEST',
        status: 422,
        message: 'The request is invalid',
        body: z.object({ issues: z.array(z.unknown()) }),
      },
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
    } as const;
    const issues = [
      { part: 'input.body', path: ['amount'], code: 'too_small', message: 'At least 1' },
    ] as const;

    const response = invalidInputResponseOf(issues, standards);

    expect(response.status).toBe(422);
    expect(await response.json()).toStrictEqual({
      rejection: {
        code: 'BAD_REQUEST',
        message: 'The request is invalid',
        body: {
          issues: [{ in: 'body', path: ['amount'], code: 'too_small', message: 'At least 1' }],
        },
      },
    });
  });
});

describe('a number literal in exponent form', () => {
  test('is read back from the plain decimal text it travels in', () => {
    const large: SchemaNode = { type: 'enum', values: [1e21], open: false };
    const small: SchemaNode = { type: 'enum', values: [1.5e-7], open: false };

    const values = [
      queryValueOf(large, [textOfValue(1e21)]),
      queryValueOf(small, [textOfValue(1.5e-7)]),
    ];

    expect(values).toEqual([1e21, 1.5e-7]);
  });
});

describe('the received Deprecation header out of range', () => {
  test('an instant before 1970 is read, one past the Date range is none', () => {
    const headers = [
      '@-1',
      '@99999999999999999',
      '@-99999999999999',
      '@253402300800',
      '@-8639977881600',
    ];

    const instants = headers.map(deprecatedAtOfHeader);

    expect(instants).toEqual(['1969-12-31T23:59:59Z', undefined, undefined, undefined, undefined]);
  });
});

describe('text that travels in a URL', () => {
  test('a path segment is neither empty, a dot segment nor a lone surrogate', () => {
    const accepted = ['a', '...', 'a b', '%', 'é', '😀'];
    const refused = ['', '.', '..', 'a\uD800', '\uDC00b'];

    expect(accepted.map(isSegmentText)).toEqual(accepted.map(() => true));
    expect(refused.map(isSegmentText)).toEqual(refused.map(() => false));
  });

  test('a segment is percent-encoded whole, a slash included', () => {
    expect(segmentOf('a/b c?')).toBe('a%2Fb%20c%3F');
  });

  test('a query value holds no lone surrogate, which URLSearchParams would replace', () => {
    const texts = ['', 'a b', '😀', 'a\uD800'];

    expect(texts.map(isQueryText)).toEqual([true, true, true, false]);
  });
});

describe('headerValuesOf', () => {
  test('each declared header present is converted by its node, others left out', () => {
    const node: SchemaNode = {
      type: 'object',
      fields: {
        'x-count': { required: true, schema: number },
        'x-ok': { required: false, schema: boolean },
      },
    };
    const headers = new Headers({ 'x-count': '3', 'x-other': 'y' });

    const values = node.type === 'object' ? headerValuesOf(node, headers) : undefined;

    expect(values).toEqual({ 'x-count': 3 });
  });
});

describe('receivedBodyOf', () => {
  test('reads a JSON body whatever its size, or says why it is no JSON', async () => {
    const large = { padding: 'x'.repeat(100_000) };
    const html = new Response('<p>', { headers: { 'content-type': 'text/html' } });

    const bodies = [await receivedBodyOf(Response.json(large)), await receivedBodyOf(html)];

    expect(bodies).toMatchObject([
      { kind: 'value', value: large },
      { kind: 'malformed', message: 'The content type is not application/json' },
    ]);
  });
});

describe('receivedBodyOf, discarding', () => {
  test('a body that is no JSON by its content type is cancelled unread', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        cancel: () => {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const html = new Response(stream, { headers: { 'content-type': 'text/html' } });

    const body = await receivedBodyOf(html);

    expect(body.kind).toBe('malformed');
    expect(cancelled).toBe(true);
  });
});

describe('receivedEnvelopeOf', () => {
  /** A stream that has already failed, as a reset leaves a body. */
  function failed(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new Error('reset')),
    });
  }

  test('a JSON body that is an Envelope is read as one, anything else as none', async () => {
    const rejection = { code: 'GONE', message: 'Gone' };
    const sent = [
      Response.json({ rejection }),
      Response.json({ error: 'x' }),
      new Response(JSON.stringify({ rejection }), { headers: { 'content-type': 'text/plain' } }),
    ];

    const read = [];
    for (const response of sent) {
      read.push(await receivedEnvelopeOf(response));
    }

    expect(read).toEqual([
      { kind: 'envelope', envelope: { rejection } },
      { kind: 'none' },
      { kind: 'none' },
    ]);
  });

  test('a Rejection Envelope is read with its code, message and body, extra keys ignored', async () => {
    const received = { rejection: { code: 'LOCKED', message: 'Locked', body: { at: 1 }, x: 1 } };

    const read = await receivedEnvelopeOf(Response.json(received));

    expect(read).toStrictEqual({
      kind: 'envelope',
      envelope: { rejection: { code: 'LOCKED', message: 'Locked', body: { at: 1 } } },
    });
  });

  test('a Rejection Envelope without a body is read with no body key', async () => {
    const received = { rejection: { code: 'GONE', message: 'Gone' } };

    const read = await receivedEnvelopeOf(Response.json(received));

    expect(read).toStrictEqual({
      kind: 'envelope',
      envelope: { rejection: { code: 'GONE', message: 'Gone' } },
    });
  });

  test('a Fault Envelope is read with its reserved code, and a code that is not reserved is dropped', async () => {
    const reserved = Response.json({
      fault: { code: 'RETIRED', committed: 'no', retryable: false, message: 'Retired' },
    });
    const unreserved = Response.json({
      fault: { code: 'DB_DOWN', committed: 'unknown', retryable: true, message: 'Down', at: 1 },
    });

    const read = [await receivedEnvelopeOf(reserved), await receivedEnvelopeOf(unreserved)];

    expect(read).toStrictEqual([
      {
        kind: 'envelope',
        envelope: {
          fault: { code: 'RETIRED', committed: 'no', retryable: false, message: 'Retired' },
        },
      },
      {
        kind: 'envelope',
        envelope: { fault: { committed: 'unknown', retryable: true, message: 'Down' } },
      },
    ]);
  });

  test('anything else is no Envelope', async () => {
    const received = [
      null,
      'text',
      [],
      {},
      { rejection: { code: 1, message: 'm' } },
      { rejection: { code: 'C' } },
      { fault: { committed: 'maybe', retryable: true, message: 'm' } },
      { fault: { committed: 'no', retryable: 'yes', message: 'm' } },
      { fault: { committed: 'no', retryable: true } },
      { error: 'boom' },
    ];

    const read = [];
    for (const body of received) {
      read.push(await receivedEnvelopeOf(Response.json(body)));
    }

    expect(read).toEqual(received.map(() => ({ kind: 'none' })));
  });

  test('a body that already failed is unreadable when JSON, none otherwise, never a throw', async () => {
    const json = new Response(failed(), { headers: { 'content-type': 'application/json' } });
    const html = new Response(failed(), { headers: { 'content-type': 'text/html' } });

    const read = [await receivedEnvelopeOf(json), await receivedEnvelopeOf(html)];

    expect(read).toMatchObject([{ kind: 'unreadable' }, { kind: 'none' }]);
  });
});

describe('malformedBodyIssueOf', () => {
  test('a body no JSON reads is one malformed Issue at the whole of the part given', () => {
    const issues = [
      malformedBodyIssueOf('input.body', 'The body is not JSON'),
      malformedBodyIssueOf('body', 'The body is not JSON'),
    ];

    expect(issues).toEqual([
      { part: 'input.body', path: [], code: 'malformed', message: 'The body is not JSON' },
      { part: 'body', path: [], code: 'malformed', message: 'The body is not JSON' },
    ]);
  });
});

describe('a body as UTF-8 JSON bytes', () => {
  test('a body written as bytes reads back as the same value, and bytes that are no UTF-8 JSON as malformed', () => {
    const body = { orderId: 'o-1', note: 'café' };

    const bytes = jsonBytesOf(body);

    expect(new TextDecoder().decode(bytes)).toBe('{"orderId":"o-1","note":"café"}');
    expect(jsonOfBytes(bytes)).toEqual({ kind: 'value', value: body });
    expect(jsonOfBytes(new Uint8Array([0xff, 0xfe]))).toMatchObject({ kind: 'malformed' });
  });
});
