import { describe, expect, test } from 'vitest';
import {
  bodyOf,
  committedValues,
  deprecatedAtOfHeader,
  deprecationHeaderOf,
  envelopeOf,
  faultEnvelopeOf,
  faultStatusOf,
  headerTextsOf,
  headerValuesOf,
  invalidInputBodyOf,
  invalidInputBodyReader,
  isHeaderText,
  isJsonContentType,
  isQueryText,
  isSegmentText,
  jsonContentType,
  receivedBodyOf,
  receivedEnvelopeOf,
  rejectionEnvelopeOf,
  reservedCodes,
  reservedFaults,
  type SchemaNode,
  segmentOf,
  textOfValue,
  valueOfText,
} from '../internal/index.ts';

const number: SchemaNode = { type: 'number' };
const boolean: SchemaNode = { type: 'boolean' };
const string: SchemaNode = { type: 'string' };

describe('valueOfText', () => {
  test('a number matching the pattern is converted, any other text is kept for the schema to refuse', () => {
    const texts = ['0', '-12', '3.25', '01', '1.', 'abc', '1e3', '+1'];

    const values = texts.map((text) => valueOfText(number, [text]));

    expect(values).toEqual([0, -12, 3.25, '01', '1.', 'abc', '1e3', '+1']);
  });

  test('a boolean is exactly true or false', () => {
    const texts = ['true', 'false', 'TRUE', 'FALSE', '1', '0'];

    const values = texts.map((text) => valueOfText(boolean, [text]));

    expect(values).toEqual([true, false, 'TRUE', 'FALSE', '1', '0']);
  });

  test('a literal and an enum take their declared value by its text, a numeric one included', () => {
    const literal: SchemaNode = { type: 'literal', value: 5 };
    const choices: SchemaNode = { type: 'enum', values: ['web', 'phone'], open: false };

    const values = [
      valueOfText(literal, ['5']),
      valueOfText(literal, ['6']),
      valueOfText(choices, ['phone']),
      valueOfText(choices, ['fax']),
    ];

    expect(values).toEqual([5, '6', 'phone', 'fax']);
  });

  test('a string is kept unchanged', () => {
    const value = valueOfText(string, [' 42 ']);

    expect(value).toBe(' 42 ');
  });

  test('a list converts each occurrence by its items, one occurrence a one-item list', () => {
    const list: SchemaNode = { type: 'array', items: number };

    const values = [valueOfText(list, ['1', '2']), valueOfText(list, ['7'])];

    expect(values).toEqual([[1, 2], [7]]);
  });

  test('a single node given several texts keeps the list, for its schema to refuse', () => {
    const value = valueOfText(number, ['1', '2']);

    expect(value).toEqual(['1', '2']);
  });
});

describe('textOfValue, isHeaderText and headerTextsOf', () => {
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
    expect(texts.map((text) => valueOfText(number, [text]))).toEqual(numbers.map((n) => n + 0));
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

    expect(accepted.map(isHeaderText)).toEqual(Array(accepted.length).fill(true));
    expect(refused.map(isHeaderText)).toEqual(Array(refused.length).fill(false));
  });

  test('a header value has no leading or trailing whitespace', () => {
    const refused = [' a', 'a ', '\ta', 'a\t', '   '];

    expect(refused.map(isHeaderText)).toEqual(Array(refused.length).fill(false));
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

describe('the Envelopes', () => {
  test('a Rejection without a body travels with no body key', () => {
    const envelope = rejectionEnvelopeOf({ code: 'NOT_FOUND', message: 'Not found' });

    expect(envelope).toStrictEqual({ rejection: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  test('a Rejection with a body carries it', () => {
    const body = { lockedAt: '2026-10-18T10:00:00Z' };

    const envelope = rejectionEnvelopeOf({ code: 'ORDER_LOCKED', message: 'Locked', body });

    expect(envelope).toStrictEqual({
      rejection: { code: 'ORDER_LOCKED', message: 'Locked', body },
    });
  });

  test('a reserved Fault carries its code, a Handler’s Fault none', () => {
    const reserved = faultEnvelopeOf({
      code: 'RETIRED',
      committed: 'no',
      retryable: false,
      message: 'The Endpoint is retired',
    });
    const returned = faultEnvelopeOf({ committed: 'yes', retryable: true, message: 'Lost' });

    expect([reserved, returned]).toStrictEqual([
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
});

describe('envelopeOf', () => {
  test('a Rejection Envelope is read with its code, message and body, extra keys ignored', () => {
    const received = { rejection: { code: 'LOCKED', message: 'Locked', body: { at: 1 }, x: 1 } };

    const envelope = envelopeOf(received);

    expect(envelope).toStrictEqual({
      rejection: { code: 'LOCKED', message: 'Locked', body: { at: 1 } },
    });
  });

  test('a Rejection Envelope without a body is read with no body key', () => {
    const envelope = envelopeOf({ rejection: { code: 'GONE', message: 'Gone' } });

    expect(envelope).toStrictEqual({ rejection: { code: 'GONE', message: 'Gone' } });
  });

  test('a Fault Envelope is read with its reserved code, and a code that is not reserved is dropped', () => {
    const reserved = envelopeOf({
      fault: { code: 'RETIRED', committed: 'no', retryable: false, message: 'Retired' },
    });
    const unreserved = envelopeOf({
      fault: { code: 'DB_DOWN', committed: 'unknown', retryable: true, message: 'Down', at: 1 },
    });

    expect([reserved, unreserved]).toStrictEqual([
      { fault: { code: 'RETIRED', committed: 'no', retryable: false, message: 'Retired' } },
      { fault: { committed: 'unknown', retryable: true, message: 'Down' } },
    ]);
  });

  test('anything else is no Envelope', () => {
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

    expect(received.map(envelopeOf)).toEqual(received.map(() => undefined));
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
      ['BODY_TOO_LARGE', { status: 413, committed: 'no', message: 'The body is too large' }],
      [
        'INVALID_OUTCOME',
        { status: 500, committed: 'unknown', message: 'The Outcome broke the Contract' },
      ],
    ]);
  });

  test('every reserved code a declaration may not take has its row', () => {
    expect(Object.keys(reservedFaults)).toEqual([...reservedCodes]);
  });

  test('a Fault travels with its reserved code’s status, else 503 when retryable and 500 otherwise', () => {
    const statuses = [
      faultStatusOf({ code: 'BODY_TOO_LARGE', retryable: false }),
      faultStatusOf({ retryable: true }),
      faultStatusOf({ retryable: false }),
    ];

    expect(statuses).toEqual([413, 503, 500]);
  });

  test('committed is no, yes or unknown', () => {
    expect(committedValues).toEqual(['no', 'yes', 'unknown']);
  });
});

describe('the content type', () => {
  test('bodies travel as UTF-8 JSON', () => {
    expect(jsonContentType).toBe('application/json; charset=utf-8');
  });

  test('a request names JSON by its media type, whatever its parameters or case', () => {
    const accepted = [
      'application/json',
      'application/json; charset=utf-8',
      'Application/JSON ;x=1',
    ];
    const refused = ['text/plain', 'application/jsonx', 'application/problem+json', '', null];

    expect(accepted.map(isJsonContentType)).toEqual([true, true, true]);
    expect(refused.map(isJsonContentType)).toEqual([false, false, false, false, false]);
  });
});

describe('bodyOf', () => {
  test('a body sent with another content type is malformed, its Issue at input.body', async () => {
    const request = new Request('http://test/', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });

    const body = await bodyOf(request, undefined);

    expect(body).toEqual({
      kind: 'malformed',
      issue: {
        part: 'input.body',
        path: [],
        code: 'malformed',
        message: 'The content type is not application/json',
      },
    });
  });

  test('a body that is no JSON is malformed, its Issue at input.body', async () => {
    const request = new Request('http://test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const body = await bodyOf(request, undefined);

    expect(body).toEqual({
      kind: 'malformed',
      issue: { part: 'input.body', path: [], code: 'malformed', message: 'The body is not JSON' },
    });
  });
});

describe('bodyOf, reading a Response', () => {
  test('a JSON Response body is read as its value', async () => {
    const response = Response.json({ id: 'o-1' });

    const body = await bodyOf(response, undefined);

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

    const body = await bodyOf(response, undefined);

    expect(body).toMatchObject({
      kind: 'unreadable',
      error: failure,
      issue: { code: 'malformed' },
    });
  });
});

describe('the Deprecation header', () => {
  test('a deprecatedAt stamp is sent as @ and its unix seconds', () => {
    expect(deprecationHeaderOf('2026-10-17T09:30:00Z')).toBe('@1792229400');
  });

  test('a received Deprecation header is read back as the stamp, and anything else as none', () => {
    const headers = ['@1792229400', '1792229400', '@soon', '@1.5', ''];

    const stamps = headers.map(deprecatedAtOfHeader);

    expect(stamps).toEqual(['2026-10-17T09:30:00Z', undefined, undefined, undefined, undefined]);
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
});

describe('the invalid-input body as a Caller reads it', () => {
  test('an issue code or part a later cf-loom adds is read as its Unknown case', () => {
    const received = {
      issues: [
        { in: 'params', path: ['id'], code: 'too_small', message: 'Too small', extra: 1 },
        { in: 'cookies', path: [], code: 'too_late', message: 'Too late' },
      ],
    };

    const read = invalidInputBodyReader.safeParse(received);

    expect(read.data).toEqual({
      issues: [
        { in: 'params', path: ['id'], code: 'too_small', message: 'Too small' },
        {
          in: { unknown: 'cookies' },
          path: [],
          code: { unknown: 'too_late' },
          message: 'Too late',
        },
      ],
    });
  });
});

describe('a number literal in exponent form', () => {
  test('is read back from the plain decimal text it travels in', () => {
    const large: SchemaNode = { type: 'literal', value: 1e21 };
    const small: SchemaNode = { type: 'literal', value: 1.5e-7 };

    const values = [
      valueOfText(large, [textOfValue(1e21)]),
      valueOfText(small, [textOfValue(1.5e-7)]),
    ];

    expect(values).toEqual([1e21, 1.5e-7]);
  });
});

describe('the received Deprecation header out of range', () => {
  test('an instant before 1970 is read, one past the Date range is none', () => {
    const headers = ['@-1', '@99999999999999999', '@-99999999999999'];

    const stamps = headers.map(deprecatedAtOfHeader);

    expect(stamps).toEqual(['1969-12-31T23:59:59Z', undefined, undefined]);
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
      mode: 'open',
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
      { kind: 'malformed', issue: { code: 'malformed' } },
    ]);
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

  test('a body that already failed is unreadable when JSON, none otherwise, never a throw', async () => {
    const json = new Response(failed(), { headers: { 'content-type': 'application/json' } });
    const html = new Response(failed(), { headers: { 'content-type': 'text/html' } });

    const read = [await receivedEnvelopeOf(json), await receivedEnvelopeOf(html)];

    expect(read).toMatchObject([{ kind: 'unreadable' }, { kind: 'none' }]);
  });
});
