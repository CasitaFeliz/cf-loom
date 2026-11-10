import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  aContractProject,
  aDefinitionsPackage,
  aFixture,
  aGeneratedProject,
  anApplication,
  aProject,
  cfLoom,
  cfLoomOffline,
  generated,
  keysOf,
  lines,
  removeFixtures,
  removeProjects,
  staleSnapshotLine,
  valueAt,
  write,
} from '../test/cli-project.ts';
import { everything } from '../test/everything-schema.ts';
import { usage } from '../test/usage.ts';

afterEach(removeProjects);

afterAll(removeFixtures);

/** The media type every body of the document is keyed by. */
const mediaType = 'application/json';

const defsPrefix = '#/components/schemas/';

/** The smallest and the largest integer zod's `z.int()` admits. */
const safeMinimum = -9007199254740991;
const safeMaximum = 9007199254740991;

/** The schema of the Input body of the OpenAPI operation on a path and method. */
function inputBodyOf(path: string, method: string): unknown {
  return valueAt(document, 'paths', path, method, 'requestBody', 'content', mediaType, 'schema');
}

/** The schema of the body of the response of a status to the OpenAPI operation on a path and method. */
function responseBodyOf(path: string, method: string, status: string): unknown {
  return valueAt(
    document,
    'paths',
    path,
    method,
    'responses',
    status,
    'content',
    mediaType,
    'schema',
  );
}

/** The OpenAPI operation on a path and method. */
function operationOf(path: string, method: string): unknown {
  return valueAt(document, 'paths', path, method);
}

/** The response of a status to the OpenAPI operation on a path and method. */
function responseOf(path: string, method: string, status: string): unknown {
  return valueAt(operationOf(path, method), 'responses', status);
}

/** A component of the document. */
function componentOf(name: string): unknown {
  return valueAt(document, 'components', 'schemas', name);
}

/** The `$ref` to a component. */
function refTo(name: string): { readonly $ref: string } {
  return { $ref: `${defsPrefix}${name}` };
}

/** A property of the body `POST /echo` answers, which holds a field of every kind. */
function echoed(field: string): unknown {
  return valueAt(responseBodyOf('/echo', 'post', '200'), 'properties', field);
}

/** A property of the body `POST /extra` takes. */
function extra(field: string): unknown {
  return valueAt(inputBodyOf('/extra', 'post'), 'properties', field);
}

/** `@org/definitions`, installed as built JavaScript with one shared schema. */
const installedDefinitions: Readonly<Record<string, string>> = {
  'node_modules/@org/definitions/package.json': JSON.stringify({
    name: '@org/definitions',
    version: '4.2.0',
    type: 'module',
    exports: './index.js',
  }),
  'node_modules/@org/definitions/index.js': lines([
    "import { defineDefinitions } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    'export const money = z.object({ amount: z.int(), currency: z.string() });',
    'export const definitions = defineDefinitions({});',
  ]),
};

/** A project around a Root file. */
function aRootProject(root: readonly string[]): Readonly<Record<string, string>> {
  return { ...aContractProject(root), ...installedDefinitions };
}

/** The imports every fixture Root starts with. */
const rootImports = [
  'import {',
  '  defineService,',
  '  defineEndpoint,',
  '  defineGroup,',
  '  defineGuard,',
  '  defineRejection,',
  '  openEnum,',
  "} from '@cf-loom/contract';",
  "import { definitions, money } from '@org/definitions';",
  "import { z } from 'zod';",
  '',
];

/** The Rejections, the Guard and the Endpoints around `/orders`. */
const orders = [
  'const unauthenticated = defineRejection({',
  "  code: 'UNAUTHENTICATED',",
  '  status: 401,',
  "  message: 'The API key is missing or unknown',",
  "  headers: z.object({ 'www-authenticate': z.string() }),",
  '});',
  'const orderLocked = defineRejection({',
  "  code: 'ORDER_LOCKED',",
  '  status: 409,',
  "  message: 'The order can no longer be changed',",
  "  headers: z.object({ 'x-lock-owner': z.string().describe('Who holds the lock') }),",
  '  body: z.object({ lockedAt: z.iso.datetime() }),',
  '});',
  "const duplicateOrder = defineRejection({ code: 'DUPLICATE_ORDER', status: 409, message: 'The order exists' });",
  'const slowDown = defineRejection({',
  "  code: 'SLOW_DOWN',",
  '  status: 429,',
  "  message: 'Too many requests',",
  "  headers: z.object({ 'retry-after': z.int().describe('Seconds to wait') }),",
  '});',
  'const tooBusy = defineRejection({',
  "  code: 'TOO_BUSY',",
  '  status: 429,',
  "  message: 'The Service is busy',",
  "  headers: z.object({ 'retry-after': z.string().describe('An HTTP-date') }),",
  '});',
  "const orderClosed = defineRejection({ code: 'ORDER_CLOSED', status: 422, message: 'The order is closed' });",
  "const refusal = z.object({ get cause() { return refusal.optional(); } }).meta({ id: 'refusal' });",
  "const orderRefused = defineRejection({ code: 'ORDER_REFUSED', status: 422, message: 'The order is refused', body: refusal });",
  'export const apiKey = defineGuard({',
  "  name: 'apiKey',",
  "  description: 'An API key per Caller',",
  "  demands: { headers: z.object({ 'x-api-key': z.string().optional() }) },",
  '  qualifier: z.object({ scope: z.string() }),',
  '  context: z.object({ callerId: z.string() }),',
  '  rejections: [unauthenticated],',
  '});',
  ...['bearer', 'optionalBearer', 'staleBearer'].flatMap((name) => [
    `export const ${name} = defineGuard({`,
    `  name: '${name}',`,
    "  description: 'A bearer token',",
    `  demands: { headers: z.object({ authorization: z.string()${name === 'optionalBearer' ? '.optional()' : ''} }) },`,
    '});',
  ]),
  'export const createOrder = defineEndpoint({',
  "  name: 'createOrder',",
  "  method: 'POST',",
  "  path: '/orders',",
  "  visibility: 'public',",
  "  description: 'Places a pending order',",
  '  input: { body: z.object({ customerId: z.uuid(), total: money }) },',
  '  success: { status: 201, body: z.object({ orderId: z.uuid() }) },',
  '  rejections: [orderLocked, duplicateOrder],',
  '});',
  'export const getOrder = defineEndpoint({',
  "  name: 'getOrder',",
  "  method: 'GET',",
  "  path: '/orders/:orderId',",
  "  visibility: 'internal',",
  "  description: 'One order by id',",
  "  guards: [{ guard: apiKey, qualifier: { scope: 'orders:read' } }],",
  '  input: {',
  '    params: z.object({ orderId: z.uuid() }),',
  "    query: z.object({ expand: z.array(z.string()).optional(), page: z.int().optional().describe('The page') }),",
  "    headers: z.object({ accept: z.string().optional(), 'x-trace-id': z.string().optional() }),",
  '  },',
  '  success: {',
  '    status: 200,',
  "    headers: z.object({ 'x-state': z.string().describe('The state of the order') }),",
  '    body: z.object({ orderId: z.uuid(), state: z.string() }),',
  '  },',
  '  rejections: [orderLocked],',
  '});',
  'export const getItem = defineEndpoint({',
  "  name: 'getItem',",
  "  method: 'GET',",
  "  path: '/orders/:orderId/items/:itemId',",
  "  visibility: 'public',",
  "  description: 'One item of an order',",
  '  guards: [bearer],',
  '  input: {',
  '    params: z.object({ orderId: z.uuid(), itemId: z.string() }),',
  '    query: z.object({ lang: z.string() }),',
  '  },',
  '  success: { status: 200, body: z.object({ itemId: z.string() }) },',
  '  rejections: [orderRefused, slowDown, tooBusy],',
  '});',
  'export const deleteOrder = defineEndpoint({',
  "  name: 'deleteOrder',",
  "  method: 'DELETE',",
  "  path: '/orders/:orderId',",
  "  visibility: 'public',",
  "  description: 'Deletes an order',",
  "  lifecycle: 'deprecated',",
  "  deprecatedAt: '2026-10-17T09:30:00Z',",
  '  input: { params: z.object({ orderId: z.uuid() }) },',
  '  success: { status: 204 },',
  '  rejections: [orderLocked],',
  '});',
  "const chain = z.object({ get next() { return chain.optional(); } }).meta({ id: 'chain' });",
  'export const lockOrder = defineEndpoint({',
  "  name: 'lockOrder',",
  "  method: 'PUT',",
  "  path: '/orders/:orderId',",
  "  visibility: 'public',",
  "  description: 'Locks an order',",
  "  lifecycle: 'retired',",
  "  guards: [{ guard: apiKey, qualifier: { scope: 'orders:write' } }, staleBearer],",
  '  input: {',
  '    params: z.object({ orderId: z.uuid() }),',
  '    query: z.object({ force: z.boolean().optional() }),',
  '    body: chain,',
  '  },',
  '  success: { status: 200, body: z.object({ locked: z.boolean() }) },',
  '  rejections: [orderClosed],',
  '});',
  "const ordersGroup = defineGroup({ name: 'orders', description: 'Order lifecycle', endpoints: [createOrder, getOrder, getItem, deleteOrder, lockOrder] });",
];

/** The Endpoints that hold every node, the regexes and formats, and a description with U+2028. */
const shapes = [
  ...everything,
  "const tooBig = defineRejection({ code: 'PAYLOAD_TOO_BIG', status: 413, message: 'Too big' });",
  'const extras = z.object({',
  '  slug: z.string().regex(/^[a-z-]+$/),',
  '  folded: z.string().regex(/^[a-z]+$/i),',
  '  letters: z.string().regex(/^\\p{L}+$/u),',
  '  at: z.iso.datetime(),',
  '  localAt: z.iso.datetime({ local: true }),',
  '  minuteAt: z.iso.datetime({ precision: -1 }),',
  '  site: z.url(),',
  '  clock: z.iso.time(),',
  "  lockedAt: z.iso.datetime().nullable().describe('When it locked'),",
  "  root: tree.nullable().describe('The root'),",
  "  choice: z.enum(['a', 'b']).nullable(),",
  "  fixed: z.literal('x').nullable(),",
  '  meaning: z.literal(42),',
  '  pair: z.tuple([z.string(), z.number()]),',
  '  nothing: z.tuple([]),',
  '  anyNumbers: z.tuple([], z.number()),',
  '  span: z.iso.duration(),',
  '  day: z.iso.date(),',
  '  v4: z.ipv4(),',
  '  key: z.cuid2(),',
  '});',
  'export const echo = defineEndpoint({',
  "  name: 'echo',",
  "  method: 'POST',",
  "  path: '/echo',",
  "  visibility: 'public',",
  "  description: 'Answers what it is sent',",
  '  guards: [optionalBearer, bearer],',
  '  input: { body: everything },',
  '  success: { status: 200, body: everything },',
  '});',
  'export const extra = defineEndpoint({',
  "  name: 'extra',",
  "  method: 'POST',",
  "  path: '/extra',",
  "  visibility: 'public',",
  "  description: 'Takes the extras',",
  '  input: { body: extras, headers: z.object({ authorization: z.string() }) },',
  '  success: { status: 200, body: extras },',
  '  rejections: [tooBig],',
  '});',
  'export const proto = defineEndpoint({',
  "  name: 'proto',",
  "  method: 'POST',",
  "  path: '/proto',",
  "  visibility: 'public',",
  "  description: 'Echoes the prototype',",
  '  guards: [optionalBearer],',
  '  input: { body: z.object({ b: z.json().meta({ examples: [JSON.parse(\'{"__proto__":{"a":[1]}}\')] }) }) },',
  '  success: { status: 204 },',
  '});',
  'export const health = defineEndpoint({',
  "  name: 'health',",
  "  method: 'GET',",
  "  path: '/health',",
  "  visibility: 'private',",
  "  description: 'Is up\\u2028and running',",
  '  success: { status: 200, body: z.object({ up: z.boolean() }) },',
  '});',
  "const shapesGroup = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo, extra, proto] });",
  "const infrastructureGroup = defineGroup({ name: 'infrastructure', description: 'Infrastructure', endpoints: [health] });",
];

/** A Service named `orders-service` with an Endpoint of each Visibility, Lifecycle and shape. */
const theService = aRootProject([
  ...rootImports,
  ...orders,
  ...shapes,
  'export const contract = defineService({',
  "  name: 'orders-service',",
  '  groups: [ordersGroup, shapesGroup, infrastructureGroup],',
  '  standardRejections: definitions,',
  '});',
]);

/** A Service named `orders-service` that declares no Endpoint. */
const aServiceWithoutEndpoints = aRootProject([
  "import { defineService } from '@cf-loom/contract';",
  '',
  "export const contract = defineService({ name: 'orders-service' });",
]);

/** A Service with a Group of one Endpoint and a Group that lists only an Event. */
const aServiceWithMessagesGroup = aRootProject([
  "import { defineService, defineEndpoint, defineEvent, defineGroup } from '@cf-loom/contract';",
  "import { z } from 'zod';",
  'export const getOrder = defineEndpoint({',
  "  name: 'getOrder', method: 'GET', path: '/orders', visibility: 'public',",
  "  description: 'Gets', success: { status: 204 },",
  '});',
  'export const orderCreatedV1 = defineEvent({',
  "  name: 'OrderCreated', version: 1, visibility: 'internal',",
  "  description: 'An order was placed', body: z.object({ orderId: z.uuid() }),",
  '});',
  "const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] });",
  "const events = defineGroup({ name: 'events', description: 'Events', events: [orderCreatedV1] });",
  "export const contract = defineService({ name: 'orders-service', groups: [orders, events] });",
]);

/** A Service whose Endpoints take the recursive schemas given as their Input bodies, in the order given. */
function aServiceWithBodies(recursive: readonly string[]): Readonly<Record<string, string>> {
  const declared = recursive.map((id, index) => [
    `const body${index} = z.object({ get next() { return body${index}.optional(); } }).meta({ id: '${id}' });`,
    `export const post${index} = defineEndpoint({`,
    `  name: 'post${index}', method: 'POST', path: '/post-${index}', visibility: 'public',`,
    `  description: 'Posts', input: { body: body${index} }, success: { status: 204 },`,
    '});',
  ]);
  const names = recursive.map((_id, index) => `post${index}`);
  return aRootProject([
    "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    ...declared.flat(),
    `const group = defineGroup({ name: 'posts', description: 'Posts', endpoints: [${names.join(', ')}] });`,
    "export const contract = defineService({ name: 'orders-service', groups: [group] });",
  ]);
}

/** A Service with two Endpoints on one path that name its param as given. */
function aServiceWithParams(first: string, second: string): Readonly<Record<string, string>> {
  return aRootProject([
    "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    'export const getOrder = defineEndpoint({',
    "  name: 'getOrder', method: 'GET', path: '/orders/:" + first + "', visibility: 'public',",
    "  description: 'Gets', input: { params: z.object({ " +
      first +
      ': z.string() }) }, success: { status: 204 },',
    '});',
    'export const deleteOrder = defineEndpoint({',
    "  name: 'deleteOrder', method: 'DELETE', path: '/orders/:" +
      second +
      "', visibility: 'public',",
    "  description: 'Deletes', input: { params: z.object({ " +
      second +
      ': z.string() }) }, success: { status: 204 },',
    '});',
    "const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder, deleteOrder] });",
    "export const contract = defineService({ name: 'orders-service', groups: [group] });",
  ]);
}

let fixture = '';
let ran: { status: number | null; stdout: string; stderr: string };
let document: unknown;

beforeAll(() => {
  fixture = aFixture(theService);
  generated(fixture);
  ran = cfLoom(fixture, 'openapi');
  document = JSON.parse(ran.stdout);
});

describe('cf-loom openapi', () => {
  test('openapi exits 0 and prints nothing on stderr', () => {
    expect([ran.status, ran.stderr]).toEqual([0, '']);
  });

  test('the document is OpenAPI 3.1.1, titled with the Service’s name, at version 0.0.0', () => {
    expect(document).toMatchObject({
      openapi: '3.1.1',
      info: { title: 'orders-service', version: '0.0.0' },
    });
  });

  test('a Service that declares no Endpoint has a document with no path', () => {
    const project = aGeneratedProject(aServiceWithoutEndpoints);

    const empty = JSON.parse(cfLoom(project, 'openapi').stdout);

    expect([valueAt(empty, 'paths'), valueAt(empty, 'tags')]).toEqual([{}, []]);
  });
});

describe('cf-loom openapi: the JSON Schema of each node', () => {
  test('a string’s lengths are minLength and maxLength', () => {
    expect(echoed('plain')).toMatchObject({ type: 'string', minLength: 1, maxLength: 10 });
  });

  test('a string’s regex without flags is its pattern', () => {
    expect(extra('slug')).toEqual({ type: 'string', pattern: '^[a-z-]+$' });
  });

  test('a regex with the u flag alone is its pattern', () => {
    expect(extra('letters')).toEqual({ type: 'string', pattern: '^\\p{L}+$' });
  });

  test('a regex with a flag that changes what it matches writes no pattern', () => {
    expect(extra('folded')).toEqual({ type: 'string' });
  });

  test('a datetime is the format date-time', () => {
    expect(extra('at')).toEqual({ type: 'string', format: 'date-time' });
  });

  test('a datetime that is local or has minute precision keeps the name datetime', () => {
    expect([extra('localAt'), extra('minuteAt')]).toEqual([
      { type: 'string', format: 'datetime' },
      { type: 'string', format: 'datetime' },
    ]);
  });

  test('a url keeps the name url, which JSON Schema’s uri would admit more than zod’s', () => {
    expect(extra('site')).toEqual({ type: 'string', format: 'url' });
  });

  test('a time writes no format, since JSON Schema’s time requires an offset', () => {
    expect(extra('clock')).toEqual({ type: 'string' });
  });

  test('a duration writes no format, since JSON Schema’s duration is not zod’s', () => {
    expect(extra('span')).toEqual({ type: 'string' });
  });

  test('an email writes no format, since JSON Schema’s email is not zod’s', () => {
    expect(echoed('email')).toEqual({ type: 'string' });
  });

  test('a format JSON Schema names the same keeps its name', () => {
    expect([echoed('id'), extra('day'), extra('v4')]).toEqual([
      { type: 'string', format: 'uuid' },
      { type: 'string', format: 'date' },
      { type: 'string', format: 'ipv4' },
    ]);
  });

  test('a format JSON Schema does not name keeps its cf-loom name', () => {
    expect(extra('key')).toEqual({ type: 'string', format: 'cuid2' });
  });

  test('a z.regexes pattern, which replaces a format zod builds from a regex, is a pattern', () => {
    expect([echoed('digest'), echoed('color')]).toEqual([
      { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
      { type: 'string', pattern: '^[0-9a-fA-F]*$' },
    ]);
  });

  test('an int is an integer', () => {
    expect(echoed('count')).toMatchObject({ type: 'integer' });
  });

  test('a number’s bounds are minimum, maximum, exclusiveMinimum and exclusiveMaximum', () => {
    expect([echoed('count'), echoed('ratio')]).toEqual([
      { type: 'integer', minimum: 0, exclusiveMaximum: 100, multipleOf: 5 },
      { type: 'number', exclusiveMinimum: 0, maximum: 1 },
    ]);
  });

  test('a boolean is a boolean', () => {
    expect(echoed('flag')).toEqual({ type: 'boolean' });
  });

  test('a one-value closed enum is a const of the type of its value', () => {
    expect([echoed('kind'), extra('meaning')]).toEqual([
      { type: 'string', const: 'order' },
      { type: 'number', const: 42 },
    ]);
  });

  test('a literal of several values is an enum of them, typed by each value’s JSON type', () => {
    expect(echoed('mixed')).toEqual({ type: ['number', 'boolean'], enum: [1, 2, true] });
  });

  test('a closed enum is an enum of the type of its values', () => {
    expect(echoed('level')).toEqual({ type: 'string', enum: ['high', 'low'] });
  });

  test('an Open Enum is anyOf the enum and a string', () => {
    expect(echoed('status')).toEqual({
      anyOf: [{ enum: ['paid', 'pending'] }, { type: 'string' }],
    });
  });

  test('an object lists its properties', () => {
    expect(keysOf(valueAt(echoed('payment'), 'properties'))).toEqual(['iban', 'last4', 'type']);
  });

  test('an object lists its required fields', () => {
    expect(valueAt(echoed('payment'), 'required')).toEqual(['type']);
  });

  test('an object admits other keys', () => {
    expect(echoed('payment')).toStrictEqual({
      type: 'object',
      properties: {
        iban: { type: 'string', format: 'iban' },
        last4: { type: 'string' },
        type: { anyOf: [{ enum: ['card', 'transfer'] }, { type: 'string' }] },
      },
      required: ['type'],
    });
  });

  test('an object with no required field has no required keyword', () => {
    expect(echoed('optionals')).toStrictEqual({
      type: 'object',
      properties: { note: { type: 'string' } },
    });
  });

  test('an object admits other keys, the Input body’s included', () => {
    const bodies = [
      inputBodyOf('/echo', 'post'),
      valueAt(inputBodyOf('/echo', 'post'), 'properties', 'payment'),
    ];

    expect(bodies.map((body) => valueAt(body, 'type'))).toEqual(['object', 'object']);
    expect(bodies.map(keysOf)).toEqual([
      ['type', 'properties', 'required'],
      ['type', 'properties', 'required'],
    ]);
  });

  test('a record is additionalProperties of its value with propertyNames of its key', () => {
    expect([echoed('record'), echoed('scores')]).toEqual([
      {
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: { type: 'number' },
      },
      {
        type: 'object',
        propertyNames: { type: 'string', minLength: 2 },
        additionalProperties: { type: 'number' },
      },
    ]);
  });

  test('an array has its items, minItems and maxItems', () => {
    expect(echoed('list')).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 3,
    });
  });

  test('a tuple is prefixItems with items for its rest', () => {
    expect(echoed('tuple')).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: { type: 'boolean' },
    });
  });

  test('a tuple without rest admits no other item', () => {
    expect(extra('pair')).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: false,
    });
  });

  test('an empty tuple admits no item', () => {
    expect(extra('nothing')).toEqual({ type: 'array', minItems: 0, items: false });
  });

  test('an empty tuple with rest admits any number of its rest', () => {
    expect(extra('anyNumbers')).toEqual({
      type: 'array',
      minItems: 0,
      items: { type: 'number' },
    });
  });

  test('a union is anyOf its options', () => {
    expect(echoed('union')).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
  });

  test('an intersection that is not of open objects is allOf its items', () => {
    expect(echoed('both')).toEqual({
      allOf: [
        {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
        },
        {
          type: 'object',
          propertyNames: { type: 'string' },
          additionalProperties: { type: 'string' },
        },
      ],
    });
  });

  test('a discriminated union is oneOf its variants, each variant’s field a const', () => {
    expect(echoed('shape')).toEqual({
      oneOf: [
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'circle' }, r: { type: 'number' } },
          required: ['kind', 'r'],
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'square' }, side: { type: 'number' } },
          required: ['kind', 'side'],
        },
      ],
    });
  });

  test('a discriminated union has no discriminator, which OpenAPI would read as a component name', () => {
    expect(echoed('shape')).toStrictEqual({
      oneOf: [
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'circle' }, r: { type: 'number' } },
          required: ['kind', 'r'],
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', const: 'square' }, side: { type: 'number' } },
          required: ['kind', 'side'],
        },
      ],
    });
  });

  test('z.json() is the schema that admits any value', () => {
    expect(echoed('data')).toEqual({});
  });

  test('a nullable node’s type includes null', () => {
    expect([echoed('note'), extra('lockedAt')]).toEqual([
      { type: ['string', 'null'] },
      { type: ['string', 'null'], format: 'date-time', description: 'When it locked' },
    ]);
  });

  test('a nullable literal or enum is anyOf it and null, since null would fail its const or enum', () => {
    expect([extra('choice'), extra('fixed')]).toEqual([
      { anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }] },
      { anyOf: [{ type: 'string', const: 'x' }, { type: 'null' }] },
    ]);
  });

  test('a nullable ref keeps its description outside the anyOf', () => {
    expect(extra('root')).toEqual({
      anyOf: [{ $ref: `${defsPrefix}TreeNodeDef` }, { type: 'null' }],
      description: 'The root',
    });
  });

  test('a description is carried over', () => {
    expect(echoed('plain')).toMatchObject({ description: "It's a text" });
  });

  test('examples are carried over', () => {
    expect(echoed('optional')).toMatchObject({ examples: ['x'] });
  });

  test('an example with a __proto__ key keeps it', () => {
    const examples = valueAt(inputBodyOf('/proto', 'post'), 'properties', 'b', 'examples');

    expect(Object.keys(valueAt(examples, '0') as object)).toEqual(['__proto__']);
  });

  test('origin is left out', () => {
    const total = valueAt(inputBodyOf('/orders', 'post'), 'properties', 'total');
    const committed = readFileSync(join(fixture, 'contract.snapshot.json'), 'utf8');

    expect(committed).toContain('"origin": "@org/definitions@4.2.0#money"');
    expect(total).toEqual({
      type: 'object',
      properties: {
        amount: { type: 'integer', minimum: safeMinimum, maximum: safeMaximum },
        currency: { type: 'string' },
      },
      required: ['amount', 'currency'],
    });
  });

  test('a recursive def is written once as a component named after its type in code', () => {
    expect(valueAt(document, 'components', 'schemas', 'TreeNodeDef')).toEqual({
      type: 'object',
      properties: {
        children: { type: 'array', items: { $ref: `${defsPrefix}TreeNodeDef` } },
        label: { type: 'string' },
      },
      required: ['children', 'label'],
    });
  });

  test('each use of a recursive def is a $ref to it, with its own description beside it', () => {
    const rooted = valueAt(echoed('rooted'), 'properties', 'tree');

    expect([echoed('tree'), rooted]).toEqual([
      { $ref: `${defsPrefix}TreeNodeDef` },
      { $ref: `${defsPrefix}TreeNodeDef`, description: 'The root' },
    ]);
  });

  test('only the defs a written node reaches are components', () => {
    const schemas = valueAt(document, 'components', 'schemas') as object;

    const defs = Object.keys(schemas).filter((name) => name.endsWith('Def'));

    expect(defs.sort()).toEqual([
      'BoughDef',
      'ForestDef',
      'LeafDef',
      'RefusalDef',
      'TreeNodeDef',
      'TwigDef',
    ]);
  });

  test('every $ref of the document names a component', () => {
    const refs = [...ran.stdout.matchAll(/"\$ref": "#\/components\/schemas\/([^"]+)"/g)];
    const schemas = valueAt(document, 'components', 'schemas') as object;

    const missing = refs.map((ref) => ref[1] ?? '').filter((name) => !(name in schemas));

    expect(refs.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

/** Whether the bounds of a JSON Schema `integer` admit a value. */
function admitsInteger(schema: unknown, value: number): boolean {
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema as Record<
    string,
    number | undefined
  >;
  return (
    (minimum === undefined || value >= minimum) &&
    (maximum === undefined || value <= maximum) &&
    (exclusiveMinimum === undefined || value > exclusiveMinimum) &&
    (exclusiveMaximum === undefined || value < exclusiveMaximum)
  );
}

/** The properties of the body of `POST /ints`, an object of the schemas declared, as `openapi` prints them. */
function intsPrinted(fields: Readonly<Record<string, string>>): Readonly<Record<string, unknown>> {
  const declared = Object.entries(fields).map(([name, schema]) => `${name}: ${schema},`);
  const project = aGeneratedProject(
    aRootProject([
      "import { defineService, defineEndpoint, defineGroup } from '@cf-loom/contract';",
      "import { z } from 'zod';",
      'export const postInts = defineEndpoint({',
      "  name: 'postInts', method: 'POST', path: '/ints', visibility: 'public',",
      `  description: 'Posts', input: { body: z.object({ ${declared.join(' ')} }) }, success: { status: 204 },`,
      '});',
      "const group = defineGroup({ name: 'ints', description: 'Ints', endpoints: [postInts] });",
      "export const contract = defineService({ name: 'orders-service', groups: [group] });",
    ]),
  );
  const printed = JSON.parse(cfLoom(project, 'openapi').stdout);
  const body = valueAt(printed, 'paths', '/ints', 'post', 'requestBody', 'content', mediaType);
  return valueAt(body, 'schema', 'properties') as Readonly<Record<string, unknown>>;
}

type Bound = { readonly method: 'min' | 'max' | 'gt' | 'lt'; readonly value: number };

/** The ways an int may bound one side: none, inside the safe range, at its end, and beyond it. */
const lowerBounds: readonly (readonly Bound[])[] = [
  [],
  [{ method: 'min', value: -5 }],
  [{ method: 'min', value: safeMinimum }],
  [{ method: 'gt', value: -5 }],
  [{ method: 'gt', value: safeMinimum }],
  [{ method: 'min', value: -5e20 }],
  [{ method: 'gt', value: -5e20 }],
  [{ method: 'gt', value: safeMinimum - 1 }],
];

const upperBounds: readonly (readonly Bound[])[] = [
  [],
  [{ method: 'max', value: 5 }],
  [{ method: 'max', value: safeMaximum }],
  [{ method: 'lt', value: 5 }],
  [{ method: 'lt', value: safeMaximum }],
  [{ method: 'max', value: 5e20 }],
  [{ method: 'lt', value: 5e20 }],
  [{ method: 'lt', value: safeMaximum + 1 }],
];

/** The integers around every bound above, inside and beyond the safe range. */
const integersProbed: readonly number[] = [
  0,
  1,
  4,
  5,
  6,
  2 ** 53,
  2 ** 60,
  1e20,
  5e20,
  safeMaximum - 1,
  safeMaximum,
].flatMap((value) => [value, -value]);

/** The source of `z.int()` with the bounds, and the zod schema it declares. */
function anInt(bounds: readonly Bound[]): { source: string; schema: z.ZodNumber } {
  let source = 'z.int()';
  let schema: z.ZodNumber = z.int();
  for (const { method, value } of bounds) {
    source += `.${method}(${value})`;
    schema = schema[method](value);
  }
  return { source, schema };
}

describe('cf-loom openapi: an int is a safe integer', () => {
  test('an int with no bounds is a safe integer in JSON Schema', () => {
    const printed = intsPrinted({ bare: 'z.int()' });

    expect(printed['bare']).toEqual({
      type: 'integer',
      minimum: safeMinimum,
      maximum: safeMaximum,
    });
  });

  test('an int keeps its own lower bound and takes the safe upper bound', () => {
    const printed = intsPrinted({ low: 'z.int().min(0)' });

    expect(printed['low']).toEqual({ type: 'integer', minimum: 0, maximum: safeMaximum });
  });

  test('an int’s own exclusive bounds stand in for the safe bounds on their side', () => {
    const printed = intsPrinted({ between: 'z.int().gt(0).lt(100)' });

    expect(printed['between']).toEqual({
      type: 'integer',
      exclusiveMinimum: 0,
      exclusiveMaximum: 100,
    });
  });

  test('an int bound beyond the safe range is replaced by the safe bound', () => {
    const printed = intsPrinted({
      inclusive: 'z.int().min(-5e20).max(1e20)',
      exclusive: 'z.int().gt(-5e20).lt(1e20)',
    });

    expect([printed['inclusive'], printed['exclusive']]).toEqual([
      { type: 'integer', minimum: safeMinimum, maximum: safeMaximum },
      { type: 'integer', minimum: safeMinimum, maximum: safeMaximum },
    ]);
  });

  test('a number that is not an int has no implied bounds', () => {
    const printed = intsPrinted({ ratio: 'z.number()' });

    expect(printed['ratio']).toEqual({ type: 'number' });
  });

  test('an int’s JSON Schema admits exactly the integers its zod schema admits', () => {
    const cases = lowerBounds.flatMap((lower) =>
      upperBounds.map((upper) => anInt([...lower, ...upper])),
    );
    const fields = Object.fromEntries(cases.map(({ source }, index) => [`int${index}`, source]));

    const printed = intsPrinted(fields);

    const disagreements = cases.flatMap(({ source, schema }, index) =>
      integersProbed
        .filter(
          (value) =>
            admitsInteger(printed[`int${index}`], value) !== schema.safeParse(value).success,
        )
        .map((value) => `${source} on ${value}`),
    );
    expect(disagreements).toEqual([]);
  });
});

describe('cf-loom openapi: the OpenAPI operations', () => {
  test('an Endpoint is an OpenAPI operation under its path, its method in lower case, its name the operationId', () => {
    expect(valueAt(operationOf('/orders', 'post'), 'operationId')).toBe('createOrder');
  });

  test('two Endpoints on one path share a path item, its methods in code point order', () => {
    expect(keysOf(valueAt(document, 'paths', '/orders/{orderId}'))).toEqual([
      'delete',
      'get',
      'put',
    ]);
  });

  test('the paths are written in code point order of their template', () => {
    expect(keysOf(valueAt(document, 'paths'))).toEqual([
      '/echo',
      '/extra',
      '/health',
      '/orders',
      '/orders/{orderId}',
      '/orders/{orderId}/items/{itemId}',
      '/proto',
    ]);
  });

  test('an Endpoint’s description is its OpenAPI operation’s description', () => {
    expect(valueAt(operationOf('/orders', 'post'), 'description')).toBe('Places a pending order');
  });

  test('an Endpoint’s Group is its OpenAPI operation’s tag', () => {
    expect(valueAt(operationOf('/orders', 'post'), 'tags')).toEqual(['orders']);
  });

  test('the Groups are the document’s tags, in code point order, each with its description', () => {
    expect(valueAt(document, 'tags')).toEqual([
      { name: 'infrastructure', description: 'Infrastructure' },
      { name: 'orders', description: 'Order lifecycle' },
      { name: 'shapes', description: 'Shapes' },
    ]);
  });

  test('a Group that lists no Endpoint is no tag', () => {
    const project = aGeneratedProject(aServiceWithMessagesGroup);

    const written = JSON.parse(cfLoom(project, 'openapi').stdout);

    expect(valueAt(written, 'tags')).toEqual([{ name: 'orders', description: 'Orders' }]);
  });

  test('public, internal and private Endpoints are all written, each with its Visibility', () => {
    const visibilities = [
      operationOf('/orders', 'post'),
      operationOf('/orders/{orderId}', 'get'),
      operationOf('/health', 'get'),
    ].map((operation) => valueAt(operation, 'x-cf-loom-visibility'));

    expect(visibilities).toEqual(['public', 'internal', 'private']);
  });

  test('an OpenAPI operation lists its Guards with their Qualifiers', () => {
    expect(valueAt(operationOf('/orders/{orderId}', 'get'), 'x-cf-loom-guards')).toEqual([
      { guard: 'apiKey', qualifier: { scope: 'orders:read' } },
    ]);
  });

  test('an OpenAPI operation of an Endpoint with no Guard lists none', () => {
    expect(valueAt(operationOf('/orders', 'post'), 'x-cf-loom-guards')).toEqual([]);
  });

  test('a path param is a required path parameter with its schema, in the path’s order', () => {
    const parameters = valueAt(
      operationOf('/orders/{orderId}/items/{itemId}', 'get'),
      'parameters',
    );

    expect(valueAt(parameters, '0')).toEqual({
      name: 'orderId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
    expect(valueAt(parameters, '1')).toEqual({
      name: 'itemId',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  });

  test('a query field is a query parameter, required as declared', () => {
    const parameters = valueAt(
      operationOf('/orders/{orderId}/items/{itemId}', 'get'),
      'parameters',
    );

    expect(valueAt(parameters, '2')).toEqual({
      name: 'lang',
      in: 'query',
      required: true,
      schema: { type: 'string' },
    });
  });

  test('a list query param is an array schema, not required when optional', () => {
    const parameters = valueAt(operationOf('/orders/{orderId}', 'get'), 'parameters');

    expect(valueAt(parameters, '1')).toEqual({
      name: 'expand',
      in: 'query',
      required: false,
      schema: { type: 'array', items: { type: 'string' } },
    });
  });

  test('a parameter takes the description of its schema, which keeps it too', () => {
    const parameters = valueAt(operationOf('/orders/{orderId}', 'get'), 'parameters');

    expect(valueAt(parameters, '2')).toEqual({
      name: 'page',
      in: 'query',
      required: false,
      description: 'The page',
      schema: {
        type: 'integer',
        minimum: safeMinimum,
        maximum: safeMaximum,
        description: 'The page',
      },
    });
  });

  test('a header, a Guard’s demand included, is a header parameter named in lower case', () => {
    const parameters = valueAt(operationOf('/orders/{orderId}', 'get'), 'parameters');

    expect([valueAt(parameters, '4'), valueAt(parameters, '5')]).toEqual([
      { name: 'x-api-key', in: 'header', required: false, schema: { type: 'string' } },
      { name: 'x-trace-id', in: 'header', required: false, schema: { type: 'string' } },
    ]);
  });

  test('an accept header stays a header parameter', () => {
    const parameters = valueAt(operationOf('/orders/{orderId}', 'get'), 'parameters');

    expect(valueAt(parameters, '3')).toEqual({
      name: 'accept',
      in: 'header',
      required: false,
      schema: { type: 'string' },
    });
  });

  test('an Input body is a required application/json request body', () => {
    expect(valueAt(operationOf('/orders', 'post'), 'requestBody')).toMatchObject({
      required: true,
      content: { [mediaType]: { schema: { type: 'object' } } },
    });
  });

  test('an Active Endpoint with no Input body has no requestBody and is not marked deprecated', () => {
    expect(keysOf(operationOf('/orders/{orderId}', 'get'))).toEqual([
      'operationId',
      'tags',
      'description',
      'x-cf-loom-visibility',
      'x-cf-loom-guards',
      'parameters',
      'responses',
    ]);
  });

  test('an Endpoint with no parameter has none', () => {
    expect(keysOf(operationOf('/orders', 'post'))).toEqual([
      'operationId',
      'tags',
      'description',
      'x-cf-loom-visibility',
      'x-cf-loom-guards',
      'requestBody',
      'responses',
    ]);
  });
});

describe('cf-loom openapi: the responses', () => {
  test('the Success is the response of its status', () => {
    expect(valueAt(responseOf('/orders', 'post', '201'), 'description')).toBe('Success');
  });

  test('the Success body is the application/json content of its response', () => {
    expect(responseBodyOf('/orders', 'post', '201')).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string', format: 'uuid' } },
      required: ['orderId'],
    });
  });

  test('a Success header is a response header with its schema and description', () => {
    expect(valueAt(responseOf('/orders/{orderId}', 'get', '200'), 'headers')).toEqual({
      'x-state': {
        required: true,
        description: 'The state of the order',
        schema: { type: 'string', description: 'The state of the order' },
      },
    });
  });

  test('a Success with no body has no content', () => {
    expect(responseOf('/orders/{orderId}', 'delete', '204')).toStrictEqual({
      description: 'Success',
      headers: {
        deprecation: { required: true, schema: { type: 'string', const: '@1792229400' } },
      },
    });
  });

  test('a Rejection is the response of its code’s status, described by its code and message', () => {
    expect(valueAt(responseOf('/orders/{orderId}', 'get', '409'), 'description')).toBe(
      'ORDER_LOCKED: The order can no longer be changed',
    );
  });

  test('a Rejection’s header is a response header of its status, with its schema and description', () => {
    expect(valueAt(responseOf('/orders/{orderId}', 'get', '409'), 'headers')).toEqual({
      'x-lock-owner': {
        required: true,
        description: 'Who holds the lock',
        schema: { type: 'string', description: 'Who holds the lock' },
      },
    });
  });

  test('a Guard’s Rejection lists its headers like the Endpoint’s own', () => {
    expect(valueAt(responseOf('/orders/{orderId}', 'get', '401'), 'headers')).toEqual({
      'www-authenticate': { required: true, schema: { type: 'string' } },
    });
  });

  test('two Rejections of one status list a header only one of them requires as not required', () => {
    expect(
      valueAt(responseOf('/orders', 'post', '409'), 'headers', 'x-lock-owner', 'required'),
    ).toBe(false);
  });

  test('two Rejections of one status that declare a header with different schemas list oneOf them, their descriptions joined', () => {
    expect(
      valueAt(responseOf('/orders/{orderId}/items/{itemId}', 'get', '429'), 'headers'),
    ).toEqual({
      'retry-after': {
        required: true,
        description: 'Seconds to wait; An HTTP-date',
        schema: {
          oneOf: [
            {
              type: 'integer',
              minimum: safeMinimum,
              maximum: safeMaximum,
              description: 'Seconds to wait',
            },
            { type: 'string', description: 'An HTTP-date' },
          ],
        },
      },
    });
  });

  test('a Rejection’s response carries its code’s Envelope', () => {
    expect(responseBodyOf('/orders/{orderId}', 'get', '409')).toEqual(refTo('ORDER_LOCKED'));
  });

  test('a Guard’s Rejection is answered like the Endpoint’s own', () => {
    expect(responseBodyOf('/orders/{orderId}', 'get', '401')).toEqual(refTo('UNAUTHENTICATED'));
  });

  test('two Rejections of one status are one response whose schema is oneOf their Envelopes', () => {
    expect(responseBodyOf('/orders', 'post', '409')).toEqual({
      oneOf: [refTo('DUPLICATE_ORDER'), refTo('ORDER_LOCKED')],
    });
  });

  test('two Rejections of one status are described by both, joined', () => {
    expect(valueAt(responseOf('/orders', 'post', '409'), 'description')).toBe(
      'DUPLICATE_ORDER: The order exists; ORDER_LOCKED: The order can no longer be changed',
    );
  });

  test('every OpenAPI operation answers the invalid-input Rejection', () => {
    expect(responseBodyOf('/health', 'get', '400')).toEqual(refTo('INVALID_INPUT'));
  });

  test('the invalid-input Rejection is described by its code and message', () => {
    expect(valueAt(responseOf('/health', 'get', '400'), 'description')).toBe(
      'INVALID_INPUT: Invalid input',
    );
  });

  test('every OpenAPI operation answers the not-implemented Rejection', () => {
    expect(responseBodyOf('/health', 'get', '501')).toEqual(refTo('NOT_IMPLEMENTED'));
  });

  test('the invalid-input Rejection’s body is cf-loom’s body of Issues and the count of those omitted, an integer from 0', () => {
    const issues = valueAt(
      componentOf('INVALID_INPUT'),
      'properties',
      'rejection',
      'properties',
      'body',
    );

    expect(valueAt(issues, 'required')).toEqual(['issues', 'omittedIssues']);
    expect(valueAt(issues, 'properties', 'issues', 'type')).toBe('array');
    expect(valueAt(issues, 'properties', 'omittedIssues')).toEqual({
      type: 'integer',
      minimum: 0,
      maximum: safeMaximum,
    });
  });

  test('every OpenAPI operation answers the Fault Envelope under 500', () => {
    expect(responseBodyOf('/health', 'get', '500')).toEqual(refTo('FaultEnvelope'));
  });

  test('the 500 response is described as a Fault that is not retryable', () => {
    expect(valueAt(responseOf('/health', 'get', '500'), 'description')).toBe(
      'A Fault that is not retryable, or INVALID_OUTCOME',
    );
  });

  test('every OpenAPI operation answers the Fault Envelope under 503', () => {
    expect(responseBodyOf('/health', 'get', '503')).toEqual(refTo('FaultEnvelope'));
  });

  test('the 503 response is described as a retryable Fault', () => {
    expect(valueAt(responseOf('/health', 'get', '503'), 'description')).toBe('A retryable Fault');
  });

  test('the 503 response lists an optional retry-after header, whole seconds from 0', () => {
    expect(valueAt(responseOf('/health', 'get', '503'), 'headers', 'retry-after')).toEqual({
      required: false,
      description: 'When to retry, in whole seconds, if the Fault says',
      schema: { type: 'integer', minimum: 0 },
    });
  });

  test('an OpenAPI operation with an Input body answers the Fault Envelope under 413', () => {
    expect(responseBodyOf('/orders', 'post', '413')).toEqual(refTo('FaultEnvelope'));
  });

  test('the 413 response is described as BODY_TOO_LARGE', () => {
    expect(valueAt(responseOf('/orders', 'post', '413'), 'description')).toBe(
      'BODY_TOO_LARGE: The body is too large, when serve is given maxBodyBytes as a number',
    );
  });

  test('an OpenAPI operation with no Input body does not answer 413', () => {
    expect(keysOf(valueAt(operationOf('/health', 'get'), 'responses'))).toEqual([
      '200',
      '400',
      '500',
      '501',
      '503',
    ]);
  });

  test('a Rejection with the status of a Fault shares its response with the Fault Envelope', () => {
    expect(responseBodyOf('/extra', 'post', '413')).toEqual({
      oneOf: [refTo('PAYLOAD_TOO_BIG'), refTo('FaultEnvelope')],
    });
  });

  test('the responses are written in status order', () => {
    expect(keysOf(valueAt(operationOf('/orders/{orderId}', 'get'), 'responses'))).toEqual([
      '200',
      '400',
      '401',
      '409',
      '500',
      '501',
      '503',
    ]);
  });
});

describe('cf-loom openapi: the components', () => {
  test('the Rejection Envelope is written once', () => {
    expect(componentOf('RejectionEnvelope')).toEqual({
      type: 'object',
      required: ['rejection'],
      properties: {
        rejection: {
          type: 'object',
          required: ['code', 'message'],
          properties: { code: { type: 'string' }, message: { type: 'string' }, body: {} },
        },
      },
    });
  });

  test('the Fault Envelope is written once, its code one of the reserved ones', () => {
    expect(componentOf('FaultEnvelope')).toEqual({
      type: 'object',
      required: ['fault'],
      properties: {
        fault: {
          type: 'object',
          required: ['committed', 'retryable', 'message'],
          properties: {
            code: {
              enum: [
                'BODY_TOO_LARGE',
                'INVALID_OUTCOME',
                'METHOD_NOT_ALLOWED',
                'NO_SUCH_ENDPOINT',
                'RETIRED',
              ],
            },
            committed: { enum: ['no', 'yes', 'unknown'] },
            retryable: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    });
  });

  test('a code’s Envelope is the Rejection Envelope with its code as a const', () => {
    const rejection = valueAt(componentOf('ORDER_LOCKED'), 'properties', 'rejection');

    expect([
      valueAt(componentOf('ORDER_LOCKED'), 'allOf'),
      valueAt(rejection, 'properties', 'code'),
    ]).toEqual([[refTo('RejectionEnvelope')], { const: 'ORDER_LOCKED' }]);
  });

  test('a code’s Envelope admits any message text, since each declaration sends its own', () => {
    const rejection = valueAt(componentOf('ORDER_LOCKED'), 'properties', 'rejection');

    expect(valueAt(rejection, 'properties', 'message')).toEqual({ type: 'string' });
  });

  test('a code’s Envelope requires its body as declared', () => {
    const rejection = valueAt(componentOf('ORDER_LOCKED'), 'properties', 'rejection');

    expect([valueAt(rejection, 'required'), valueAt(rejection, 'properties', 'body')]).toEqual([
      ['body'],
      {
        type: 'object',
        properties: { lockedAt: { type: 'string', format: 'date-time' } },
        required: ['lockedAt'],
      },
    ]);
  });

  test('a code with no body has an Envelope that admits no body key', () => {
    const rejection = valueAt(componentOf('DUPLICATE_ORDER'), 'properties', 'rejection');

    expect(rejection).toEqual({
      properties: {
        code: { const: 'DUPLICATE_ORDER' },
        message: { type: 'string' },
        body: false,
      },
    });
  });

  test('a def only a Rejection’s body reaches is a component', () => {
    const rejection = valueAt(componentOf('ORDER_REFUSED'), 'properties', 'rejection');

    expect(valueAt(rejection, 'properties', 'body')).toEqual(refTo('RefusalDef'));
    expect(valueAt(componentOf('RefusalDef'), 'properties', 'cause')).toEqual(refTo('RefusalDef'));
  });

  test('each code a written Endpoint answers is a component', () => {
    const codes = keysOf(valueAt(document, 'components', 'schemas')).filter((name) =>
      /^[A-Z_]+$/.test(name),
    );

    expect(codes).toEqual([
      'DUPLICATE_ORDER',
      'INVALID_INPUT',
      'NOT_IMPLEMENTED',
      'ORDER_LOCKED',
      'ORDER_REFUSED',
      'PAYLOAD_TOO_BIG',
      'SLOW_DOWN',
      'TOO_BUSY',
      'UNAUTHENTICATED',
    ]);
  });

  test('a code only a Retired Endpoint answers is not a component, nor is one no Endpoint answers', () => {
    const names = keysOf(valueAt(document, 'components', 'schemas'));

    expect(names).not.toContain('ORDER_CLOSED');
    expect(names).not.toContain('NOT_FOUND');
  });

  test('the components are written in code point order', () => {
    const names = keysOf(valueAt(document, 'components', 'schemas'));

    expect(names).toEqual([...names].sort());
  });
});

describe('cf-loom openapi: lifecycle', () => {
  test('a Deprecated Endpoint is deprecated', () => {
    expect(valueAt(operationOf('/orders/{orderId}', 'delete'), 'deprecated')).toBe(true);
  });

  test('each response of a Deprecated Endpoint carries the Deprecation header of its deprecatedAt', () => {
    const committed = JSON.parse(readFileSync(join(fixture, 'contract.snapshot.json'), 'utf8'));
    const deprecatedAt = valueAt(committed, 'endpoints', 'DELETE /orders/{}', 'deprecatedAt');
    const responses = valueAt(operationOf('/orders/{orderId}', 'delete'), 'responses');
    const expected = {
      required: true,
      schema: { type: 'string', const: `@${Math.floor(Date.parse(String(deprecatedAt)) / 1000)}` },
    };

    const headers = keysOf(responses).map((status) =>
      valueAt(responses, status, 'headers', 'deprecation'),
    );

    expect(headers.length).toBeGreaterThan(1);
    expect(headers).toEqual(headers.map(() => expected));
  });

  test('an Endpoint that is not Deprecated sets no Deprecation header', () => {
    expect(JSON.stringify(operationOf('/orders/{orderId}', 'get'))).not.toContain('deprecation');
  });

  test('a Retired Endpoint is deprecated', () => {
    expect(valueAt(operationOf('/orders/{orderId}', 'put'), 'deprecated')).toBe(true);
  });

  test('a Retired Endpoint answers only 410', () => {
    expect(keysOf(valueAt(operationOf('/orders/{orderId}', 'put'), 'responses'))).toEqual(['410']);
  });

  test('a Retired Endpoint answers 410 with the Fault Envelope', () => {
    expect(responseBodyOf('/orders/{orderId}', 'put', '410')).toEqual(refTo('FaultEnvelope'));
  });

  test('a Retired Endpoint’s 410 is described as RETIRED', () => {
    expect(valueAt(responseOf('/orders/{orderId}', 'put', '410'), 'description')).toBe(
      'RETIRED: The Endpoint is retired',
    );
  });

  test('a Retired Endpoint keeps its path parameters and no query or header parameter', () => {
    expect(valueAt(operationOf('/orders/{orderId}', 'put'), 'parameters')).toEqual([
      {
        name: 'orderId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
    ]);
  });

  test('a Retired Endpoint has no request body and no security', () => {
    expect(keysOf(operationOf('/orders/{orderId}', 'put'))).toEqual([
      'operationId',
      'tags',
      'description',
      'deprecated',
      'x-cf-loom-visibility',
      'x-cf-loom-guards',
      'parameters',
      'responses',
    ]);
  });

  test('a Retired Endpoint keeps its Visibility', () => {
    expect(valueAt(operationOf('/orders/{orderId}', 'put'), 'x-cf-loom-visibility')).toBe('public');
  });

  test('a Retired Endpoint keeps its Guards', () => {
    expect(valueAt(operationOf('/orders/{orderId}', 'put'), 'x-cf-loom-guards')).toEqual([
      { guard: 'apiKey', qualifier: { scope: 'orders:write' } },
      { guard: 'staleBearer', qualifier: null },
    ]);
  });

  test('a Retired Endpoint sets no Deprecation header', () => {
    expect(JSON.stringify(operationOf('/orders/{orderId}', 'put'))).not.toContain('deprecation');
  });
});

describe('cf-loom openapi: the authorization header', () => {
  const scheme = { type: 'apiKey', in: 'header', name: 'authorization' };

  test('a Guard that demands authorization is a security scheme named after it', () => {
    expect(valueAt(document, 'components', 'securitySchemes', 'bearer')).toEqual(scheme);
  });

  test('an Endpoint attaching that Guard requires the scheme', () => {
    expect(valueAt(operationOf('/orders/{orderId}/items/{itemId}', 'get'), 'security')).toEqual([
      { bearer: [] },
    ]);
  });

  test('an authorization demand is no header parameter', () => {
    const parameters = valueAt(
      operationOf('/orders/{orderId}/items/{itemId}', 'get'),
      'parameters',
    );

    const names = (parameters as readonly unknown[]).map((parameter) => valueAt(parameter, 'name'));

    expect(names).toEqual(['orderId', 'itemId', 'lang']);
  });

  test('an optional authorization header adds the empty requirement as an alternative', () => {
    expect(valueAt(operationOf('/proto', 'post'), 'security')).toEqual([
      { optionalBearer: [] },
      {},
    ]);
  });

  test('an Endpoint’s own authorization header is the scheme named authorization', () => {
    expect([
      valueAt(document, 'components', 'securitySchemes', 'authorization'),
      valueAt(operationOf('/extra', 'post'), 'security'),
    ]).toEqual([scheme, [{ authorization: [] }]]);
  });

  test('an own authorization header is no header parameter either', () => {
    expect(keysOf(operationOf('/extra', 'post'))).toEqual([
      'operationId',
      'tags',
      'description',
      'x-cf-loom-visibility',
      'x-cf-loom-guards',
      'requestBody',
      'responses',
      'security',
    ]);
  });

  test('several Guards that demand authorization are one requirement, its schemes in code point order', () => {
    const requirement = valueAt(operationOf('/echo', 'post'), 'security', '0');

    expect(keysOf(requirement)).toEqual(['bearer', 'optionalBearer']);
  });

  test('several Guards that demand authorization require it when one does', () => {
    expect(valueAt(operationOf('/echo', 'post'), 'security')).toHaveLength(1);
  });

  test('an Endpoint with no authorization header has no security', () => {
    expect(keysOf(operationOf('/health', 'get'))).toEqual([
      'operationId',
      'tags',
      'description',
      'x-cf-loom-visibility',
      'x-cf-loom-guards',
      'responses',
    ]);
  });

  test('the security schemes are the Guards of Endpoints that are not Retired, in code point order', () => {
    expect(keysOf(valueAt(document, 'components', 'securitySchemes'))).toEqual([
      'authorization',
      'bearer',
      'optionalBearer',
    ]);
  });

  test('a document with no authorization header has no securitySchemes', () => {
    const project = aGeneratedProject(aServiceWithBodies(['body']));

    const plain = JSON.parse(cfLoom(project, 'openapi').stdout);

    expect(keysOf(valueAt(plain, 'components'))).toEqual(['schemas']);
  });
});

describe('cf-loom openapi: what it prints', () => {
  test('the document is JSON indented by two spaces with a final newline', () => {
    const [first, second] = ran.stdout.split('\n');

    expect([first, second, ran.stdout.endsWith('}\n')]).toEqual([
      '{',
      '  "openapi": "3.1.1",',
      true,
    ]);
  });

  test('two runs print the same bytes', () => {
    const again = cfLoom(fixture, 'openapi');

    expect(again.stdout).toBe(ran.stdout);
  });

  test('the document’s keys are in OpenAPI’s usual order', () => {
    expect(keysOf(document)).toEqual(['openapi', 'info', 'tags', 'paths', 'components']);
  });

  test('a description holding U+2028 is printed as its JSON escape and parses back to the same text', () => {
    const description = valueAt(operationOf('/health', 'get'), 'description');

    expect(ran.stdout).not.toContain('\u2028');
    expect(ran.stdout).toContain('Is up\\u2028and running');
    expect(description).toBe('Is up\u2028and running');
  });

  test('openapi runs offline: with no npm on PATH and the registry at a dead address, it prints the document', async () => {
    const offline = await cfLoomOffline(fixture, 'openapi');

    expect(offline).toEqual({ status: 0, stdout: ran.stdout, stderr: '' });
  });
});

describe('cf-loom openapi: what it refuses', () => {
  test('openapi fails when contract.snapshot.json is missing, exit 1, printing no document', () => {
    const project = aProject(theService);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('openapi fails when contract.snapshot.json is out of date, exit 1, printing no document', () => {
    const project = aGeneratedProject(theService);
    write(project, aServiceWithoutEndpoints);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('a Root that breaks a rule fails openapi with generate’s lines', () => {
    const project = aProject({
      ...theService,
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    });

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'src/contract/index.ts: (root) name package-name: A Root is named as its package.json, without the scope: "orders-service" is written, package.json names "billing-service"\n',
    });
  });

  test('a contract.snapshot.json that is no JSON is a tooling error', () => {
    const project = aProject({ ...theService, 'contract.snapshot.json': '<<<<<<< HEAD\n' });

    const refused = cfLoom(project, 'openapi');

    expect(refused.status).toBe(3);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toMatch(
      /^contract\.snapshot\.json is no JSON \([^\n]+\): run cf-loom generate\n$/,
    );
  });

  test('an Application has no OpenAPI document, a tooling error', () => {
    const project = aProject(anApplication);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: 'An Application has no OpenAPI document: only a Service offers Endpoints\n',
    });
  });

  test('a Definitions Package has no OpenAPI document, a tooling error', () => {
    const project = aProject(aDefinitionsPackage);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: 'A Definitions Package has no OpenAPI document: only a Service offers Endpoints\n',
    });
  });

  test('two Endpoints on one path that name a param differently are a tooling error naming both', () => {
    const project = aGeneratedProject(aServiceWithParams('orderId', 'id'));

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr:
        '"DELETE /orders/{}" and "GET /orders/{}" name path param 1 id and orderId: an OpenAPI path names it once, so rename one\n',
    });
  });

  test('two Endpoints on one path that name its params alike are written', () => {
    const project = aGeneratedProject(aServiceWithParams('orderId', 'orderId'));

    const written = cfLoom(project, 'openapi');

    expect(written.status).toBe(0);
  });

  test('openapi takes no argument', () => {
    const project = aProject({});

    const refused = cfLoom(project, 'openapi', 'now');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: `openapi takes no argument. ${usage}\n`,
    });
  });

  test.for([
    ['--out', ['--out', 'folder'], 'Only package takes --out'],
    ['--prefix', ['--prefix', 'staging'], 'Only broker-plan and asyncapi take --prefix'],
    ['--force', ['--force'], 'Only publish takes --force'],
    ['--prerelease', ['--prerelease'], 'Only check and publish take --prerelease'],
  ] as const)('openapi does not take %s', ([_option, options, message]) => {
    const project = aProject({});

    const refused = cfLoom(project, 'openapi', ...options);

    expect(refused).toEqual({ status: 3, stdout: '', stderr: `${message}. ${usage}\n` });
  });
});
