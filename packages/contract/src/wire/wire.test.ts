import { describe, expect, test } from 'vitest';
import {
  canTravelAsHeader,
  committedValues,
  deprecationHeaderOf,
  faultEnvelopeOf,
  faultStatusOf,
  invalidInputBodyOf,
  isJsonContentType,
  jsonContentType,
  rejectionEnvelopeOf,
  reservedCodes,
  reservedFaults,
  type SchemaNode,
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

describe('textOfValue and canTravelAsHeader', () => {
  test('a value travels as the text JavaScript writes it', () => {
    expect([textOfValue(3), textOfValue(-1.5), textOfValue(true), textOfValue('v1')]).toEqual([
      '3',
      '-1.5',
      'true',
      'v1',
    ]);
  });

  test('a header value holds no NUL, LF or CR and nothing above U+00FF', () => {
    const accepted = ['v1', 'a, b', 'café', '\u00ff', ''];
    const refused = ['€', 'a\nb', 'a\rb', 'a\u0000b', '😀'];

    expect(accepted.map(canTravelAsHeader)).toEqual(Array(5).fill(true));
    expect(refused.map(canTravelAsHeader)).toEqual(Array(5).fill(false));
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

describe('the Deprecation header', () => {
  test('a deprecatedAt stamp is sent as @ and its unix seconds', () => {
    expect(deprecationHeaderOf('2026-10-17T09:30:00Z')).toBe('@1792229400');
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
