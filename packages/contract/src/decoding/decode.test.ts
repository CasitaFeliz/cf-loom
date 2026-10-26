import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { randomSchemas, seededNext } from '../../test/random-schemas.ts';
import { aRootPackage } from '../../test/root-package.ts';
import { publishedAt, schemaExports } from '../../test/snapshots.ts';
import {
  type ContractPackage,
  defineCommand,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
  providedEvent,
} from '../index.ts';
import {
  canonicalTextOf,
  type DecodedSnapshot,
  decodeSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  type GuardSnapshot,
  type ObjectNode,
  type Path,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  publishedSnapshotOf,
  type RefNode,
  type SchemaNode,
  type ServiceSnapshot,
  type Snapshot,
  snapshotOf,
  validateRoot,
  walkSchemas,
} from '../internal/index.ts';

const invalidInputCode = 'INVALID_INPUT';
const notFoundCode = 'NOT_FOUND';
const notImplementedCode = 'NOT_IMPLEMENTED';

const standardRejections: PublishedServiceSnapshot['standardRejections'] = {
  invalidInput: invalidInputCode,
  notFound: notFoundCode,
  notImplemented: notImplementedCode,
};

const standardCodes = {
  [invalidInputCode]: {
    origin: 'standard',
    status: 400,
    message: 'Invalid',
    body: { type: 'object', fields: {} },
  },
  [notFoundCode]: {
    origin: 'standard',
    status: 404,
    message: 'Not found',
    body: null,
  },
  [notImplementedCode]: {
    origin: 'standard',
    status: 501,
    message: 'No',
    body: null,
  },
} as const satisfies PublishedServiceSnapshot['codes'];

function aService(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    version: '3.4.0',
    generator: '@cf-loom/cli@2.1.0',
    standardRejections,
    groups: { orders: { description: 'Order lifecycle' } },
    defs: {},
    endpoints: {},
    events: {},
    commands: {},
    guards: {},
    codes: standardCodes,
    subscriptions: {},
    dependencies: {},
    ...fields,
  };
}

function anApplication(
  fields: Partial<PublishedApplicationSnapshot> = {},
): PublishedApplicationSnapshot {
  return {
    format: 1,
    kind: 'application',
    name: 'orders-web',
    version: '1.0.0',
    generator: '@cf-loom/cli@2.1.0',
    dependencies: {},
    ...fields,
  };
}

function aDefinitions(
  fields: Partial<PublishedDefinitionsSnapshot> = {},
): PublishedDefinitionsSnapshot {
  return {
    format: 1,
    kind: 'definitions',
    name: 'definitions',
    version: '4.2.0',
    generator: '@cf-loom/cli@2.1.0',
    standardRejections,
    defs: {},
    exports: schemaExports({}),
    guards: {},
    codes: standardCodes,
    ...fields,
  };
}

/** A text part with no field, as the Snapshot writes one declared empty or not declared. */
const emptyPart = { type: 'object', fields: {} } as const;

const anEndpoint = {
  name: 'getOrder',
  group: 'orders',
  visibility: 'public',
  lifecycle: 'active',
  description: 'One order',
  params: ['orderId'],
  guards: [],
  input: {
    params: { type: 'object', fields: { orderId: { required: true, schema: { type: 'string' } } } },
    query: emptyPart,
    headers: emptyPart,
    body: null,
  },
  success: { status: 200, headers: emptyPart, body: null },
  rejections: [],
} as const satisfies EndpointSnapshot;

/** The Endpoint fixture on a path with no params, as `POST /orders` has none. */
const withoutParams = { ...anEndpoint, params: [], input: { ...anEndpoint.input, params: null } };

const anEvent = {
  group: 'orders',
  visibility: 'internal',
  lifecycle: 'active',
  description: 'An order was placed',
  body: { type: 'object', fields: {} },
} as const satisfies EventSnapshot;

const aCommand = {
  group: 'orders',
  lifecycle: 'active',
  description: 'Charge',
  body: anEvent.body,
} as const;

const aGuard = {
  origin: 'local',
  description: 'An API key',
  guards: [],
  qualifier: null,
  demands: { headers: emptyPart, query: emptyPart },
  context: null,
  rejections: [],
} as const satisfies GuardSnapshot;

const orderLocked = 'ORDER_LOCKED';
const unauthenticated = 'UNAUTHENTICATED';
const gone = 'GONE';

const aCode = { origin: 'local', status: 409, message: 'Locked', body: null };

const retiredEndpoint = { ...anEndpoint, lifecycle: 'retired', retiredIn: '3.0.0' } as const;
const endpointTombstone = {
  lifecycle: 'retired',
  retiredIn: '3.0.0',
  name: 'purgeOrders',
} as const;
const messageTombstone = { lifecycle: 'retired', retiredIn: '3.1.0' } as const;

const stringNode: SchemaNode = { type: 'string' };

function aRef(name: string): RefNode {
  return { type: 'ref', name };
}

function anObjectOf(schema: SchemaNode): ObjectNode {
  return { type: 'object', fields: { name: { required: true, schema } } };
}

/** A Snapshot's text as the registry holds it, whatever is wrong with it. */
function decodedFrom(snapshot: object): DecodedSnapshot {
  return decodeSnapshot(JSON.stringify(snapshot));
}

/** The Service fixture with fields written over it, right or wrong. */
function serviceWith(fields: object): DecodedSnapshot {
  return decodedFrom({ ...aService(), ...fields });
}

function snapshotOfDecoded(result: DecodedSnapshot): PublishedSnapshot {
  if (result.kind !== 'decoded') {
    throw new Error(`Expected a decoded Snapshot: ${JSON.stringify(result)}`);
  }
  return result.snapshot;
}

function roundTrip(snapshot: PublishedSnapshot): DecodedSnapshot {
  return decodeSnapshot(canonicalTextOf(snapshot));
}

function malformedAt(at: readonly (string | number)[], reason: unknown = expect.any(String)) {
  return { kind: 'malformed', at, reason };
}

/** A map written with `__proto__` as a key of its own, as JSON text can. */
function protoKeyed(value: unknown): object {
  return JSON.parse(`{"__proto__": ${JSON.stringify(value)}}`);
}

/** The Element a malformed result lies in; which key inside it is named is up to the structure. */
function elementOf(result: DecodedSnapshot): readonly (string | number)[] | undefined {
  return result.kind === 'malformed' ? result.at.slice(0, 2) : undefined;
}

const everyNode: SchemaNode = {
  type: 'object',
  fields: {
    text: {
      required: true,
      schema: {
        type: 'string',
        format: 'datetime',
        formatOptions: { offset: true, precision: 3 },
        regex: { source: '^2', flags: 'i' },
        min: 1,
        max: 40,
        nullable: true,
        description: 'When',
        examples: ['2026-10-17T09:30:00Z'],
        origin: '@org/definitions@4.2.0#when',
      },
    },
    count: {
      required: false,
      schema: {
        type: 'number',
        int: true,
        min: 0,
        max: 10,
        exclusiveMin: -1,
        exclusiveMax: 11,
        multipleOf: 2,
      },
    },
    flag: { required: true, schema: { type: 'boolean' } },
    one: { required: true, schema: { type: 'enum', values: ['a'], open: false } },
    color: { required: true, schema: { type: 'enum', values: ['red', 2, true], open: true } },
    lookup: {
      required: true,
      schema: { type: 'record', key: { type: 'string' }, value: aRef('tree') },
    },
    tags: { required: true, schema: { type: 'array', items: { type: 'string' }, min: 1, max: 3 } },
    pair: {
      required: true,
      schema: { type: 'tuple', items: [{ type: 'string' }], rest: { type: 'number' } },
    },
    either: {
      required: true,
      schema: { type: 'union', options: [{ type: 'string' }, { type: 'boolean' }] },
    },
    shape: {
      required: true,
      schema: {
        type: 'tagged',
        discriminator: 'kind',
        variants: {
          '"a"': {
            type: 'object',
            fields: {
              kind: { required: true, schema: { type: 'enum', values: ['a'], open: false } },
            },
          },
          '"b"': aRef('tree'),
        },
      },
    },
    both: {
      required: true,
      schema: { type: 'allOf', items: [{ type: 'json' }, { type: 'string' }] },
    },
  },
};

const treeDef: SchemaNode = {
  type: 'object',
  fields: { children: { required: true, schema: { type: 'array', items: aRef('tree') } } },
};

describe('decodeSnapshot', () => {
  describe('what decodes', () => {
    test('a Service’s published Snapshot, written as canonical text, decodes to the same Snapshot', () => {
      const published = aService({
        defs: { tree: treeDef },
        endpoints: {
          'GET /orders/{}': {
            ...anEndpoint,
            guards: [{ guard: 'apiKey', qualifier: ['orders:read'] }],
            input: {
              params: {
                type: 'object',
                fields: { orderId: { required: true, schema: { type: 'string' } } },
              },
              query: emptyPart,
              headers: emptyPart,
              body: aRef('tree'),
            },
            rejections: ['ORDER_LOCKED'],
          },
        },
        events: { 'OrderPlaced@1': anEvent },
        commands: { 'ChargeCard@1': aCommand },
        guards: { apiKey: aGuard },
        codes: { ...standardCodes, [orderLocked]: aCode },
        subscriptions: {
          notifyOnPlaced: {
            group: 'orders',
            description: 'Receives it',
            event: 'orders-service:OrderPlaced@1',
          },
        },
        dependencies: {
          'payments-service': {
            against: '5.1.0',
            endpoints: [{ id: 'GET /payments/{}', name: 'getPayment' }],
          },
        },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a Snapshot built from a Contract decodes once it has a version and a generator', () => {
      const snapshot = declaredSnapshot();
      const published = { ...snapshot, ...publishedAt('1.0.0') };

      const result = decodedFrom(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('every node type decodes, with the constraints and annotations it may carry', () => {
      const published = aService({
        defs: { tree: treeDef },
        endpoints: {
          'POST /orders': {
            ...anEndpoint,
            params: [],
            input: { params: null, query: emptyPart, headers: emptyPart, body: everyNode },
          },
        },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('an Application’s published Snapshot decodes', () => {
      const published = anApplication({
        dependencies: {
          'orders-service': {
            against: '3.4.0',
            endpoints: [{ id: 'GET /orders/{}', name: 'getOrder' }],
          },
        },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a Definitions Package’s published Snapshot decodes, its shared schemas and removed codes included', () => {
      const published = aDefinitions({
        exports: schemaExports({ money: { type: 'object', fields: {} } }),
        guards: { apiKey: { ...aGuard, rejections: ['UNAUTHENTICATED'] } },
        codes: {
          ...standardCodes,
          [unauthenticated]: { ...aCode, status: 401 },
          [gone]: { ...aCode, status: 410, removedIn: '3.2.0' },
        },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('an Endpoint’s tombstone decodes with its name and retiredIn', () => {
      const published = aService({ endpoints: { 'DELETE /orders/{}': endpointTombstone } });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('an Event’s and a Command’s tombstones decode with their retiredIn, each in its own map', () => {
      const published = aService({
        events: { 'OrderPurged@1': messageTombstone },
        commands: { 'PurgeOrders@1': messageTombstone },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a still-declared Retired Element decodes with its retiredIn', () => {
      const published = aService({
        endpoints: { 'GET /orders/{}': retiredEndpoint },
        events: { 'OrderPlaced@1': { ...anEvent, lifecycle: 'retired', retiredIn: '3.0.0' } },
        commands: { 'ChargeCard@1': { ...aCommand, lifecycle: 'retired', retiredIn: '3.0.0' } },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a removed Subscription decodes with its Event and removedIn', () => {
      const published = aService({
        subscriptions: {
          legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' },
        },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a removed code decodes with its removedIn and the status and body it last had', () => {
      const body: SchemaNode = { type: 'object', fields: {} };
      const published = aService({
        codes: { ...standardCodes, [gone]: { ...aCode, status: 410, body, removedIn: '3.2.0' } },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a Deprecated Endpoint’s deprecatedAt decodes', () => {
      const deprecated = {
        ...anEndpoint,
        lifecycle: 'deprecated',
        deprecatedAt: '2026-10-17T09:30:00Z',
      } as const;
      const published = aService({ endpoints: { 'GET /orders/{}': deprecated } });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a recursive def reached through a ref decodes', () => {
      const published = aService({
        defs: { tree: treeDef },
        events: { 'TreeChanged@1': { ...anEvent, body: aRef('tree') } },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a prerelease version decodes, as every Contract Package before cf-loom 1.0.0 is one', () => {
      const published = aService({
        version: '0.3.0-rc.1',
        endpoints: { 'GET /orders/{}': { ...retiredEndpoint, retiredIn: '0.2.0-beta.4' } },
        subscriptions: {
          legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '0.3.0-rc.1' },
        },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a Snapshot whose keys are out of code point order decodes in canonical order', () => {
      const published = aService({
        endpoints: { 'POST /orders': withoutParams, 'GET /orders/{}': anEndpoint },
        defs: { b: { type: 'string' }, a: { type: 'string' } },
      });

      const result = decodedFrom(published);

      const snapshot = snapshotOfDecoded(result);
      expect(canonicalTextOf(snapshot)).toBe(canonicalTextOf(published));
      expect(Object.keys('defs' in snapshot ? snapshot.defs : {})).toEqual(['a', 'b']);
      expect(Object.keys('endpoints' in snapshot ? snapshot.endpoints : {})).toEqual([
        'GET /orders/{}',
        'POST /orders',
      ]);
    });

    test('a union whose option is an array of itself decodes', () => {
      const listing: SchemaNode = {
        type: 'union',
        options: [{ type: 'array', items: aRef('listing') }, stringNode],
      };
      const published = aService({ defs: { listing } });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a tagged node whose variant is a ref to its own def decodes', () => {
      const tree: SchemaNode = {
        type: 'tagged',
        discriminator: 'type',
        variants: { '"branch"': aRef('tree') },
      };
      const published = aService({ defs: { tree } });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('an alias def of a recursive def decodes', () => {
      const published = aService({ defs: { alias: aRef('tree'), tree: treeDef } });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('the format-1 fixture decodes and keeps every value it holds', () => {
      const result = decodeSnapshot(formatOneFixture);

      const snapshot = snapshotOfDecoded(result);
      expect(JSON.parse(canonicalTextOf(snapshot))).toEqual(JSON.parse(formatOneFixture));
    });
  });

  describe('what fails closed', () => {
    test.each(['', '{"format": 1', 'not json'])(
      'a text that is no JSON is no-json: "%s"',
      (text) => {
        const result = decodeSnapshot(text);

        expect(result).toEqual({ kind: 'no-json', reason: expect.any(String) });
      },
    );

    test.each([2, 99])('a format newer than this cf-loom knows is newer-format %s', (format) => {
      const result = serviceWith({ format });

      expect(result).toEqual({ kind: 'newer-format', format });
    });

    test.each([0, -1, 1.5, '1', null, true])(
      'a format that is not a whole number from 1 is malformed at format: %s',
      (format) => {
        const result = serviceWith({ format });

        expect(result).toEqual(malformedAt(['format']));
      },
    );

    test.each(['{}', '[]', '5', 'null', '"snapshot"'])(
      'a text with no format is malformed at format: %s',
      (text) => {
        const result = decodeSnapshot(text);

        expect(result).toEqual(malformedAt(['format']));
      },
    );

    test('a Snapshot nested far too deeply to decode is malformed at its depth limit, never a throw', () => {
      const nested =
        '{"type":"array","items":'.repeat(5000) + '{"type":"string"}' + '}'.repeat(5000);
      const text = JSON.stringify(aService()).replace('"defs":{}', `"defs":{"a":${nested}}`);

      const result = decodeSnapshot(text);

      const at = ['defs', 'a', ...Array<string>(254).fill('items')];
      expect(result).toEqual(malformedAt(at, 'nests deeper than 256 levels'));
    });

    test('a shallow Snapshot whose canonical text outgrows a string is malformed at the root, never a throw', () => {
      const elements = Array(1_500_000).fill('1').join(',');
      const example = `${'['.repeat(250)}${elements}${']'.repeat(250)}`;
      const text = JSON.stringify(aService()).replace(
        '"defs":{}',
        `"defs":{"a":{"type":"json","examples":[${example}]}}`,
      );

      const result = decodeSnapshot(text);

      expect(result).toEqual(malformedAt([], 'is too large or nests too deeply to decode'));
    });

    test.each([
      { where: 'the Snapshot', snapshot: { ...aService(), ...protoKeyed(1) }, at: ['__proto__'] },
      {
        where: 'defs',
        snapshot: { ...aService(), defs: protoKeyed({ type: 'string' }) },
        at: ['defs', '__proto__'],
      },
      {
        where: 'endpoints',
        snapshot: { ...aService(), endpoints: protoKeyed(anEndpoint) },
        at: ['endpoints', '__proto__'],
      },
      {
        where: 'events',
        snapshot: { ...aService(), events: protoKeyed(anEvent) },
        at: ['events', '__proto__'],
      },
      {
        where: 'commands',
        snapshot: { ...aService(), commands: protoKeyed(aCommand) },
        at: ['commands', '__proto__'],
      },
      {
        where: 'guards',
        snapshot: { ...aService(), guards: protoKeyed(aGuard) },
        at: ['guards', '__proto__'],
      },
      {
        where: 'codes',
        snapshot: { ...aService(), codes: protoKeyed(aCode) },
        at: ['codes', '__proto__'],
      },
      {
        where: 'subscriptions',
        snapshot: {
          ...aService(),
          subscriptions: protoKeyed({
            group: 'orders',
            description: 'Receives it',
            event: 'orders-service:A@1',
          }),
        },
        at: ['subscriptions', '__proto__'],
      },
      {
        where: 'an Application’s dependencies',
        snapshot: {
          ...anApplication(),
          dependencies: protoKeyed({ against: '1.0.0', endpoints: [] }),
        },
        at: ['dependencies', '__proto__'],
      },
      {
        where: 'a Definitions Package’s exports',
        snapshot: {
          ...aDefinitions(),
          exports: protoKeyed({ kind: 'schema', schema: { type: 'string' } }),
        },
        at: ['exports', '__proto__'],
      },
      {
        where: 'an object node’s fields',
        snapshot: {
          ...aService(),
          defs: {
            tree: {
              type: 'object',
              fields: protoKeyed({ required: true, schema: { type: 'string' } }),
            },
          },
        },
        at: ['defs', 'tree', 'fields', '__proto__'],
      },
      {
        where: 'a string node’s formatOptions',
        snapshot: {
          ...aService(),
          defs: { tree: { type: 'string', formatOptions: protoKeyed(true) } },
        },
        at: ['defs', 'tree', 'formatOptions', '__proto__'],
      },
      {
        where: 'a tagged node’s variants',
        snapshot: {
          ...aService(),
          defs: {
            tree: {
              type: 'tagged',
              discriminator: 'kind',
              variants: protoKeyed({ type: 'ref', name: 'tree' }),
            },
          },
        },
        at: ['defs', 'tree', 'variants', '__proto__'],
      },
    ])('a __proto__ key in $where is malformed at that key, never dropped', ({ snapshot, at }) => {
      const result = decodedFrom(snapshot);

      expect(result).toEqual(malformedAt(at));
    });

    test('a __proto__ key says no map of a Snapshot holds one', () => {
      const result = serviceWith({ defs: protoKeyed({ type: 'string' }) });

      expect(result).toEqual(
        malformedAt(['defs', '__proto__'], 'is a key no map of a Snapshot holds'),
      );
    });

    test.each([
      ['null', null],
      ['a list', []],
      ['a number', 3],
    ])('a map given as %s is malformed at the map', (_, map) => {
      const result = serviceWith({ defs: map });

      expect(result).toEqual(malformedAt(['defs']));
    });

    test('a Service’s Snapshot with a definitions map is malformed: its origins say which packages it uses', () => {
      const result = decodedFrom({ ...aService(), definitions: { '@org/definitions': '4.2.0' } });

      expect(result).toEqual(malformedAt(['definitions'], 'is a key its format does not define'));
    });

    test('keys named like an Object’s own properties are kept as the keys they are', () => {
      const text: SchemaNode = { type: 'string' };
      const published = aService({
        defs: { constructor: text, toString: text, hasOwnProperty: text },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test.each([
      [
        'an Endpoint’s query',
        {
          endpoints: {
            'GET /orders/{}': { ...anEndpoint, input: { ...anEndpoint.input, query: null } },
          },
        },
        ['endpoints', 'GET /orders/{}', 'input', 'query'],
      ],
      [
        'an Endpoint’s headers',
        {
          endpoints: {
            'GET /orders/{}': { ...anEndpoint, input: { ...anEndpoint.input, headers: null } },
          },
        },
        ['endpoints', 'GET /orders/{}', 'input', 'headers'],
      ],
      [
        'a Success’s headers',
        {
          endpoints: {
            'GET /orders/{}': { ...anEndpoint, success: { ...anEndpoint.success, headers: null } },
          },
        },
        ['endpoints', 'GET /orders/{}', 'success', 'headers'],
      ],
      [
        'a Guard’s demanded query',
        { guards: { apiKey: { ...aGuard, demands: { ...aGuard.demands, query: null } } } },
        ['guards', 'apiKey', 'demands', 'query'],
      ],
      [
        'a Guard’s demanded headers',
        { guards: { apiKey: { ...aGuard, demands: { ...aGuard.demands, headers: null } } } },
        ['guards', 'apiKey', 'demands', 'headers'],
      ],
    ])(
      '%s given as null is malformed there: a text part is an object with no field when none is declared',
      (_, fields, at) => {
        const result = serviceWith(fields);

        expect(elementOf(result)).toEqual(at.slice(0, 2));
      },
    );

    describe('an Endpoint’s params are its identity’s, each a required field of input.params', () => {
      const at = ['endpoints', 'GET /orders/{}'];
      const paramsAt = [...at, 'input', 'params'];
      const idField = { required: true, schema: { type: 'string' } } as const;

      test.each([
        [
          'more names than the identity has {}',
          { params: ['orderId', 'lineId'] },
          [...at, 'params'],
        ],
        ['fewer names than the identity has {}', { params: [] }, [...at, 'params']],
        ['a name twice', { params: ['orderId', 'orderId'] }, [...at, 'params']],
        [
          'null where the path has params',
          { input: { ...anEndpoint.input, params: null } },
          paramsAt,
        ],
        [
          'a field named otherwise than the param',
          { input: { ...anEndpoint.input, params: { type: 'object', fields: { id: idField } } } },
          paramsAt,
        ],
        [
          'a field beside the params',
          {
            input: {
              ...anEndpoint.input,
              params: { type: 'object', fields: { orderId: idField, lineId: idField } },
            },
          },
          paramsAt,
        ],
        [
          'an optional param',
          {
            input: {
              ...anEndpoint.input,
              params: { type: 'object', fields: { orderId: { ...idField, required: false } } },
            },
          },
          [...paramsAt, 'fields', 'orderId'],
        ],
      ])('%s is malformed where it is', (_name, fields, expectedAt) => {
        const result = serviceWith({
          endpoints: { 'GET /orders/{}': { ...anEndpoint, ...fields } },
        });

        expect(result).toEqual(malformedAt(expectedAt));
      });

      test('a params object on a path without params is malformed at it', () => {
        const result = serviceWith({
          endpoints: {
            'POST /orders': {
              ...withoutParams,
              input: { ...withoutParams.input, params: emptyPart },
            },
          },
        });

        expect(result).toEqual(malformedAt(['endpoints', 'POST /orders', 'input', 'params']));
      });

      test('a tombstone names no params, so none are judged', () => {
        const result = serviceWith({
          endpoints: {
            'GET /orders/{}': { lifecycle: 'retired', retiredIn: '1.0.0', name: 'getOrder' },
          },
        });

        expect(result.kind).toBe('decoded');
      });
    });

    test('a nullable def is malformed at the def: nullable belongs to a use of it', () => {
      const tree: SchemaNode = { type: 'object', fields: {}, nullable: true };

      const result = serviceWith({ defs: { tree } });

      expect(result).toEqual(malformedAt(['defs', 'tree'], expect.stringContaining('nullable')));
    });

    test('a Snapshot without version is malformed at version: package writes none, only publish does', () => {
      const { version: _version, ...declared } = aService();

      const result = decodedFrom(declared);

      expect(result).toEqual(malformedAt(['version'], 'is missing'));
    });

    test.each(['3.4', 'v3.4.0', '^3.4.0', 'latest', 340])(
      'a version that is not a semantic version is malformed at version: %s',
      (version) => {
        const result = serviceWith({ version });

        expect(result).toEqual(malformedAt(['version']));
      },
    );

    test('a generator that is no string is malformed at generator, in cf-loom’s words', () => {
      const result = serviceWith({ generator: 42 });

      expect(result).toEqual(malformedAt(['generator'], 'is not a string'));
    });

    test('a Snapshot without a generator is malformed at generator: it is missing', () => {
      const { generator: _generator, ...declared } = aService();

      const result = decodedFrom(declared);

      expect(result).toEqual(malformedAt(['generator'], 'is missing'));
    });

    test('a Snapshot without a kind is malformed at kind: it is missing', () => {
      const { kind: _kind, ...declared } = aService();

      const result = decodedFrom(declared);

      expect(result).toEqual(malformedAt(['kind'], 'is missing'));
    });

    test('a kind the format does not define is malformed at kind', () => {
      const result = serviceWith({ kind: 'library' });

      expect(result).toEqual(malformedAt(['kind']));
    });

    test('a key the format does not define is malformed at that key, at the top and inside a node', () => {
      const atTheTop = serviceWith({ extra: true });
      const insideNode = serviceWith({ defs: { tree: { ...treeDef, extra: 1 } } });

      expect([atTheTop, insideNode]).toEqual([
        malformedAt(['extra']),
        malformedAt(['defs', 'tree', 'extra']),
      ]);
    });

    test.each([
      ['a node type', { defs: { tree: { type: 'bogus' } } }, ['defs', 'tree', 'type']],
      [
        'a string format',
        { defs: { tree: { type: 'string', format: 'phone' } } },
        ['defs', 'tree', 'format'],
      ],
      [
        'a literal node',
        { defs: { tree: { type: 'literal', value: 'a' } } },
        ['defs', 'tree', 'type'],
      ],
      [
        'a mode on an object',
        { defs: { tree: { type: 'object', mode: 'open', fields: {} } } },
        ['defs', 'tree', 'mode'],
      ],
      [
        'a record keyed by an enum',
        {
          defs: {
            tree: {
              type: 'record',
              key: { type: 'enum', values: ['a'], open: false },
              value: { type: 'string' },
            },
          },
        },
        ['defs', 'tree', 'key', 'type'],
      ],
      [
        'a nullable record key',
        {
          defs: {
            tree: {
              type: 'record',
              key: { type: 'string', nullable: true },
              value: { type: 'string' },
            },
          },
        },
        ['defs', 'tree', 'key', 'nullable'],
      ],
      [
        'a Standard Rejection',
        { standardRejections: { ...standardRejections, gone: standardRejections.notFound } },
        ['standardRejections', 'gone'],
      ],
    ])('%s the format does not define is malformed where it sits', (_, fields, at) => {
      const result = serviceWith(fields);

      expect(result).toEqual(malformedAt(at));
    });

    test.each([
      [
        'a nullable that is not true',
        { type: 'string', nullable: false },
        ['defs', 'tree', 'nullable'],
      ],
      [
        'a regex with a key of its own',
        { type: 'string', regex: { source: 'a', flags: '', extra: 1 } },
        ['defs', 'tree', 'regex', 'extra'],
      ],
      [
        'a field with a key of its own',
        {
          type: 'object',
          fields: { name: { required: true, schema: { type: 'string' }, extra: 1 } },
        },
        ['defs', 'tree', 'fields', 'name', 'extra'],
      ],
      [
        'a variant that is neither an object nor a ref',
        { type: 'tagged', discriminator: 'kind', variants: { a: { type: 'string' } } },
        ['defs', 'tree', 'variants', 'a', 'type'],
      ],
    ])('a node with %s is malformed where it sits', (_, node, at) => {
      const result = serviceWith({ defs: { tree: node } });

      expect(result).toEqual(malformedAt(at));
    });

    test.each([
      [
        'an option no string format takes',
        { type: 'string', format: 'datetime', formatOptions: { offset: true, extra: true } },
        'extra',
      ],
      [
        'an option of another string format',
        { type: 'string', format: 'uuid', formatOptions: { precision: 3 } },
        'precision',
      ],
      [
        'an option of a string format that takes none',
        { type: 'string', format: 'hex', formatOptions: { version: 4 } },
        'version',
      ],
      [
        'an option with no string format',
        { type: 'string', formatOptions: { offset: true } },
        'offset',
      ],
      [
        'an option generate refuses',
        { type: 'string', format: 'url', formatOptions: { normalize: true } },
        'normalize',
      ],
    ])('a string node with %s is malformed at that option', (_, node, option) => {
      const result = serviceWith({ defs: { tree: node } });

      expect(result).toEqual(malformedAt(['defs', 'tree', 'formatOptions', option]));
    });

    test.each([
      { name: 'notFound', code: notFoundCode },
      { name: 'notImplemented', code: notImplementedCode },
    ] as const)(
      'a body on the code the $name Standard Rejection names is malformed at the body',
      ({ name, code }) => {
        const codes = { ...standardCodes, [code]: { ...standardCodes[code], body: stringNode } };

        const service = serviceWith({ codes });
        const definitions = decodedFrom({ ...aDefinitions(), codes });

        const malformed = malformedAt(
          ['codes', code, 'body'],
          `holds a body, which the ${name} Standard Rejection never has`,
        );
        expect([service, definitions]).toEqual([malformed, malformed]);
      },
    );

    test('no body on the code the invalidInput Standard Rejection names is malformed at the body', () => {
      const code = invalidInputCode;
      const codes = { ...standardCodes, [code]: { ...standardCodes[code], body: null } };

      const service = serviceWith({ codes });
      const definitions = decodedFrom({ ...aDefinitions(), codes });

      const malformed = malformedAt(
        ['codes', code, 'body'],
        'holds no body, which the invalidInput Standard Rejection always has',
      );
      expect([service, definitions]).toEqual([malformed, malformed]);
    });

    test.each([
      [
        'a Dependency’s Endpoint with a key of its own',
        {
          dependencies: {
            'payments-service': {
              against: '5.1.0',
              endpoints: [{ id: 'GET /payments/{}', name: 'getPayment', extra: 1 }],
              events: [],
            },
          },
        },
        ['dependencies', 'payments-service', 'endpoints', 0, 'extra'],
      ],
      [
        'a Guard’s demands with a key of its own',
        {
          guards: {
            apiKey: { ...aGuard, demands: { headers: emptyPart, query: emptyPart, extra: 1 } },
          },
        },
        ['guards', 'apiKey', 'demands', 'extra'],
      ],
    ])('%s is malformed where it sits', (_, fields, at) => {
      const result = serviceWith(fields);

      expect(result).toEqual(malformedAt(at));
    });

    test.each([
      ['lifecycle', { ...anEndpoint, lifecycle: 'sunset' }],
      ['visibility', { ...anEndpoint, visibility: 'global' }],
    ])(
      'an Endpoint with a %s the format does not define is malformed in the Endpoint',
      (_, endpoint) => {
        const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

        expect(elementOf(result)).toEqual(['endpoints', 'GET /orders/{}']);
      },
    );

    test('an Event with a visibility the format does not define is malformed in the Event', () => {
      const event = { ...anEvent, visibility: 'global' };

      const result = serviceWith({ events: { 'OrderPlaced@1': event } });

      expect(elementOf(result)).toEqual(['events', 'OrderPlaced@1']);
    });

    test('a node type the format does not define lists the node types it defines', () => {
      const result = serviceWith({ defs: { tree: { type: 'bogus' } } });

      expect(result).toEqual(
        malformedAt(
          ['defs', 'tree', 'type'],
          expect.stringMatching(/^is none of "string", "number", "boolean", .*"ref"$/),
        ),
      );
    });

    test('a kind the format does not define lists the kinds it defines', () => {
      const result = serviceWith({ kind: 'library' });

      expect(result).toEqual(
        malformedAt(['kind'], 'is none of "service", "application", "definitions"'),
      );
    });

    test.for([null, {}, ['a']])(
      'an enum value that is no string, number or boolean is malformed at that value: %j',
      (value) => {
        const enumNode = { type: 'enum', values: [value], open: false };

        const result = serviceWith({ defs: { tree: enumNode } });

        expect(result).toEqual(
          malformedAt(['defs', 'tree', 'values', 0], 'is not a string, a number, true or false'),
        );
      },
    );

    describe('an Element is read as declared or as a tombstone by its Group, a declared one by its lifecycle, so the key that breaks it is named', () => {
      const deprecatedAt = '2026-10-17T09:30:00Z';
      const elements = [
        {
          kind: 'Endpoint',
          map: 'endpoints',
          identity: 'GET /orders/{}',
          forms: {
            active: anEndpoint,
            deprecated: { ...anEndpoint, lifecycle: 'deprecated', deprecatedAt },
            retired: retiredEndpoint,
            tombstone: endpointTombstone,
          },
        },
        {
          kind: 'Event',
          map: 'events',
          identity: 'OrderPlaced@1',
          forms: {
            active: anEvent,
            deprecated: { ...anEvent, lifecycle: 'deprecated' },
            retired: { ...anEvent, lifecycle: 'retired', retiredIn: '3.0.0' },
            tombstone: messageTombstone,
          },
        },
        {
          kind: 'Command',
          map: 'commands',
          identity: 'ChargeCard@1',
          forms: {
            active: aCommand,
            deprecated: { ...aCommand, lifecycle: 'deprecated' },
            retired: { ...aCommand, lifecycle: 'retired', retiredIn: '3.0.0' },
            tombstone: messageTombstone,
          },
        },
      ];
      const everyForm = elements.flatMap(({ kind, map, identity, forms }) =>
        Object.entries(forms).map(([form, element]) => ({ kind, map, identity, form, element })),
      );
      const everyField = everyForm.flatMap((placed) =>
        Object.keys(placed.element).map((field) => ({ ...placed, field })),
      );

      const declaredForms = elements.flatMap(({ kind, map, identity, forms }) => [
        { kind, form: 'active', map, identity, element: forms.active },
        { kind, form: 'deprecated', map, identity, element: forms.deprecated },
      ]);

      test.each(declaredForms)(
        'the $form form of a published $kind without its Group is read as a tombstone, as the format defines',
        ({ map, identity, element }) => {
          const { group: _group, ...tombstoneLike } = element;

          const result = serviceWith({ [map]: { [identity]: tombstoneLike } });

          expect(result).toEqual(malformedAt([map, identity, 'lifecycle'], 'is not "retired"'));
        },
      );

      test('a Retired Endpoint without its Group is read as a tombstone, so its first other key is named', () => {
        const { group: _group, ...tombstoneLike } = retiredEndpoint;

        const result = serviceWith({ endpoints: { 'GET /orders/{}': tombstoneLike } });

        expect(result).toEqual(
          malformedAt(
            ['endpoints', 'GET /orders/{}', 'visibility'],
            'is a key its format does not define',
          ),
        );
      });

      test('a published Endpoint with a visibility that is no Visibility is malformed at the visibility', () => {
        const endpoint = { ...anEndpoint, visibility: 'nope' };

        const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

        expect(result).toEqual(
          malformedAt(
            ['endpoints', 'GET /orders/{}', 'visibility'],
            'is none of "public", "internal", "private"',
          ),
        );
      });

      test('a Deprecated Endpoint with a description that is no string is malformed at the description', () => {
        const endpoint = { ...anEndpoint, lifecycle: 'deprecated', description: 42 };

        const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

        expect(result).toEqual(
          malformedAt(['endpoints', 'GET /orders/{}', 'description'], 'is not a string'),
        );
      });

      test.each(elements)(
        'the tombstone of a published $kind with a key of its own is malformed at that key',
        ({ map, identity, forms }) => {
          const tombstone = { ...forms.tombstone, extra: true };

          const result = serviceWith({ [map]: { [identity]: tombstone } });

          expect(result).toEqual(
            malformedAt([map, identity, 'extra'], 'is a key its format does not define'),
          );
        },
      );

      test.each([
        [
          'a lifecycle that is none of the three',
          { ...anEndpoint, lifecycle: 'archived' },
          'is none of "active", "deprecated", "retired"',
        ],
        [
          'a lifecycle that is no string',
          { ...anEndpoint, lifecycle: null },
          'is none of "active", "deprecated", "retired"',
        ],
        ['no lifecycle', { ...anEndpoint, lifecycle: undefined }, 'is missing'],
      ])('an Endpoint with %s is malformed at the lifecycle', (_, endpoint, reason) => {
        const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

        expect(result).toEqual(malformedAt(['endpoints', 'GET /orders/{}', 'lifecycle'], reason));
      });

      test('an Endpoint without a visibility is malformed at the visibility: it is missing', () => {
        const { visibility: _visibility, ...endpoint } = anEndpoint;

        const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

        expect(result).toEqual(
          malformedAt(['endpoints', 'GET /orders/{}', 'visibility'], 'is missing'),
        );
      });

      test.each(everyForm)(
        'the $form form of a published $kind holding a __proto__ key is malformed at that key, never dropped',
        ({ map, identity, element }) => {
          const holding = { ...element, ...protoKeyed(1) };

          const result = serviceWith({ [map]: { [identity]: holding } });

          expect(result).toEqual(
            malformedAt([map, identity, '__proto__'], 'is a key its format does not define'),
          );
        },
      );

      test('a Retired Endpoint still declared without retiredIn is malformed at the retiredIn', () => {
        const endpoint = { ...anEndpoint, lifecycle: 'retired' };

        const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

        expect(result).toEqual(
          malformedAt(['endpoints', 'GET /orders/{}', 'retiredIn'], 'is missing'),
        );
      });

      test.each(elements)(
        'the tombstone of a published $kind without retiredIn is malformed at the retiredIn: it is missing',
        ({ map, identity, forms }) => {
          const { retiredIn: _retiredIn, ...tombstone } = forms.tombstone;

          const result = serviceWith({ [map]: { [identity]: tombstone } });

          expect(result).toEqual(malformedAt([map, identity, 'retiredIn'], 'is missing'));
        },
      );

      test.each([
        ['a Retired Endpoint still declared', retiredEndpoint],
        ['an Endpoint’s tombstone', endpointTombstone],
      ])('%s with a retiredIn that is no semantic version keeps that reason', (_, retired) => {
        const endpoint = { ...retired, retiredIn: 'three' };

        const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

        expect(result).toEqual(
          malformedAt(['endpoints', 'GET /orders/{}', 'retiredIn'], 'is not a semantic version'),
        );
      });

      test.each(everyField)(
        'the $form form of a published $kind with a $field of the wrong type is malformed at that $field',
        ({ map, identity, element, field }) => {
          const wrong = { ...element, [field]: null };
          const zodsWording = /^(Invalid|Unrecognized|Too )/;

          const result = serviceWith({ [map]: { [identity]: wrong } });

          expect(result).toEqual(
            malformedAt([map, identity, field], expect.not.stringMatching(zodsWording)),
          );
        },
      );
    });

    test('an Application’s Snapshot holding endpoints is malformed', () => {
      const result = decodedFrom({ ...anApplication(), endpoints: {} });

      expect(result).toEqual(malformedAt(['endpoints']));
    });

    test.each([
      { kind: 'an Event', map: 'events', key: 'OrderPlaced@1', declared: anEvent },
      { kind: 'a Command', map: 'commands', key: 'ChargeCard@1', declared: aCommand },
    ])('$kind declared without a Group is malformed in it', ({ map, key, declared }) => {
      const { group: _group, ...ungrouped } = declared;

      const result = serviceWith({ [map]: { [key]: ungrouped } });

      expect(elementOf(result)).toEqual([map, key]);
    });

    test.each([
      ['no description', { event: 'orders-service:OrderPlaced@1' }],
      ['no Group', { description: 'Receives it', event: 'orders-service:OrderPlaced@1' }],
      [
        'a Group and a removedIn',
        { group: 'orders', event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' },
      ],
      [
        'a description and a removedIn',
        {
          group: 'orders',
          description: 'Receives it',
          event: 'orders-service:OrderPlaced@1',
          removedIn: '3.2.0',
        },
      ],
      [
        'a removedIn that is no semantic version',
        { event: 'orders-service:OrderPlaced@1', removedIn: 'gone' },
      ],
    ])('a Subscription with %s is malformed in the Subscription', (_, subscription) => {
      const result = serviceWith({ subscriptions: { notifyOnPlaced: subscription } });

      expect(elementOf(result)).toEqual(['subscriptions', 'notifyOnPlaced']);
    });

    describe('a Subscription is read as declared or as a tombstone by its Group, so the key that breaks it is named', () => {
      const event = 'orders-service:OrderPlaced@1';
      const declared = { group: 'orders', description: 'Receives it', event };
      const removed = { event, removedIn: '3.2.0' };
      const at = (key: string) => ['subscriptions', 'notifyOnPlaced', key];

      test.each([
        {
          name: 'a declared Subscription’s event that is no string',
          subscription: { ...declared, event: 42 },
          key: 'event',
          reason: 'is not a string',
        },
        {
          name: 'a declared Subscription’s description that is no string',
          subscription: { ...declared, description: 42 },
          key: 'description',
          reason: 'is not a string',
        },
        {
          name: 'a removed Subscription’s event that is no string',
          subscription: { ...removed, event: 42 },
          key: 'event',
          reason: 'is not a string',
        },
        {
          name: 'a removed Subscription’s removedIn that is no semantic version',
          subscription: { ...removed, removedIn: 'nope' },
          key: 'removedIn',
          reason: 'is not a semantic version',
        },
        {
          name: 'a declared Subscription with no event',
          subscription: { group: 'orders', description: 'Receives it' },
          key: 'event',
          reason: 'is missing',
        },
        {
          name: 'a removed Subscription with no event',
          subscription: { removedIn: '3.2.0' },
          key: 'event',
          reason: 'is missing',
        },
        {
          name: 'a removed Subscription with no removedIn',
          subscription: { event },
          key: 'removedIn',
          reason: 'is missing',
        },
        {
          name: 'a declared Subscription with a removedIn',
          subscription: { ...declared, removedIn: '3.2.0' },
          key: 'removedIn',
          reason: 'is a key its format does not define',
        },
        {
          name: 'a removed Subscription with a key of its own',
          subscription: { ...removed, extra: 1 },
          key: 'extra',
          reason: 'is a key its format does not define',
        },
      ])('$name is malformed at that key', ({ subscription, key, reason }) => {
        const result = serviceWith({ subscriptions: { notifyOnPlaced: subscription } });

        expect(result).toEqual(malformedAt(at(key), reason));
      });

      test('a declared Subscription without its Group is read as a tombstone, as the format defines', () => {
        const { group: _group, ...tombstoneLike } = declared;

        const result = serviceWith({ subscriptions: { notifyOnPlaced: tombstoneLike } });

        expect(result).toEqual(malformedAt(at('removedIn'), 'is missing'));
      });

      test.for([null, 42, 'notifyOnPlaced', []])(
        'a Subscription that is no object is malformed at the Subscription: %j',
        (subscription) => {
          const result = serviceWith({ subscriptions: { notifyOnPlaced: subscription } });

          expect(result).toEqual(
            malformedAt(['subscriptions', 'notifyOnPlaced'], 'is not an object'),
          );
        },
      );

      test.each([
        ['declared', declared],
        ['removed', removed],
      ])(
        'a %s Subscription holding a __proto__ key is malformed at that key, never dropped',
        (_, subscription) => {
          const holding = { ...subscription, ...protoKeyed(1) };

          const result = serviceWith({ subscriptions: { notifyOnPlaced: holding } });

          expect(result).toEqual(
            malformedAt(at('__proto__'), 'is a key its format does not define'),
          );
        },
      );
    });

    test.each([
      ['a declared Element’s fields', { ...endpointTombstone, description: 'One order' }],
      ['no retiredIn', { lifecycle: 'retired', name: 'purgeOrders' }],
      ['no name', { lifecycle: 'retired', retiredIn: '3.0.0' }],
      ['a retiredIn that is no version', { ...endpointTombstone, retiredIn: 'three' }],
      ['a lifecycle other than retired', { ...endpointTombstone, lifecycle: 'active' }],
    ])('an Endpoint’s tombstone with %s is malformed in the Endpoint', (_, tombstone) => {
      const result = serviceWith({ endpoints: { 'DELETE /orders/{}': tombstone } });

      expect(elementOf(result)).toEqual(['endpoints', 'DELETE /orders/{}']);
    });

    test.each([
      ['a declared Event’s fields', { ...messageTombstone, body: anEvent.body }],
      ['no retiredIn', { lifecycle: 'retired' }],
      ['a name', { ...messageTombstone, name: 'OrderPurged' }],
    ])('an Event’s tombstone with %s is malformed in the Event', (_, tombstone) => {
      const result = serviceWith({ events: { 'OrderPurged@1': tombstone } });

      expect(elementOf(result)).toEqual(['events', 'OrderPurged@1']);
    });

    test.each([
      [
        'a Retired Endpoint still declared without retiredIn',
        { ...anEndpoint, lifecycle: 'retired' },
      ],
      ['an Active Endpoint with retiredIn', { ...anEndpoint, retiredIn: '3.0.0' }],
      [
        'a Deprecated Endpoint with retiredIn',
        { ...anEndpoint, lifecycle: 'deprecated', retiredIn: '3.0.0' },
      ],
    ])('%s is malformed in the Endpoint', (_, endpoint) => {
      const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

      expect(elementOf(result)).toEqual(['endpoints', 'GET /orders/{}']);
    });

    test('a deprecatedAt that is not a stamp is malformed in the Endpoint', () => {
      const endpoint = { ...anEndpoint, lifecycle: 'deprecated', deprecatedAt: 'yesterday' };

      const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

      expect(elementOf(result)).toEqual(['endpoints', 'GET /orders/{}']);
    });

    test.each([
      ['no method', 'GET'],
      ['a method the format does not define', 'FETCH /orders'],
      ['HEAD, which no Endpoint declares', 'HEAD /orders'],
      ['a path that does not start with a slash', 'GET orders'],
      ['an empty segment', 'GET /orders//{}'],
      ['a trailing slash', 'GET /orders/'],
      ['a param written by its name', 'GET /orders/:orderId'],
      ['a param written inside a literal segment', 'GET /orders/a{}'],
      ['a param written before text', 'GET /orders/{}a'],
    ])('an Endpoint identity with %s is malformed at its key', (_, identity) => {
      const result = serviceWith({ endpoints: { [identity]: anEndpoint } });

      expect(result).toEqual(malformedAt(['endpoints', identity]));
    });

    test.each([
      'OrderPlaced',
      'OrderPlaced@',
      '@1',
      'OrderPlaced@0',
      'OrderPlaced@1.5',
      'OrderPlaced@v1',
      'OrderPlaced@01',
      'OrderPlaced@9007199254740992',
    ])(
      'a Message identity that is not a name and a version from 1 is malformed at its key: %s',
      (identity) => {
        const events = serviceWith({ events: { [identity]: anEvent } });
        const commands = serviceWith({ commands: { [identity]: aCommand } });

        expect(events).toEqual(malformedAt(['events', identity]));
        expect(commands).toEqual(malformedAt(['commands', identity]));
      },
    );

    test.each(['OrderPlaced@1', 'orders-service:OrderPlaced', ':OrderPlaced@1', 'orders-service:'])(
      'a Subscription’s Event that is no service and identity is malformed at the Event: %s',
      (event) => {
        const result = serviceWith({
          subscriptions: { notifyOnPlaced: { group: 'orders', description: 'Receives it', event } },
        });

        expect(result).toEqual(malformedAt(['subscriptions', 'notifyOnPlaced', 'event']));
      },
    );

    test('a Dependency’s Endpoint id that is not an identity is malformed', () => {
      const endpoints = [{ id: 'FETCH /x', name: 'x' }];
      const dependencies = { 'payments-service': { against: '5.1.0', endpoints } };

      const service = serviceWith({ dependencies });
      const application = decodedFrom({ ...anApplication(), dependencies });

      const at = ['dependencies', 'payments-service', 'endpoints', 0, 'id'];
      expect([service, application]).toEqual([malformedAt(at), malformedAt(at)]);
    });

    test('a Dependency holding events is malformed: a Service’s Subscriptions hold its Events', () => {
      const dependency = { against: '5.1.0', endpoints: [], events: ['PaymentSettled@1'] };
      const dependencies = { 'payments-service': dependency };

      const service = serviceWith({ dependencies });
      const application = decodedFrom({ ...anApplication(), dependencies });

      const at = ['dependencies', 'payments-service', 'events'];
      expect([service, application]).toEqual([malformedAt(at), malformedAt(at)]);
    });

    test('a ref to a def the Snapshot does not hold is malformed at the ref', () => {
      const defs = { tree: { type: 'array', items: aRef('missing') } };

      const result = serviceWith({ defs });

      expect(result).toEqual(malformedAt(['defs', 'tree', 'items']));
    });

    test.each([
      [
        'an Endpoint’s body',
        aService({
          endpoints: {
            'GET /orders/{}': {
              ...anEndpoint,
              input: {
                params: {
                  type: 'object',
                  fields: { orderId: { required: true, schema: { type: 'string' } } },
                },
                query: emptyPart,
                headers: emptyPart,
                body: aRef('missing'),
              },
            },
          },
        }),
        ['endpoints', 'GET /orders/{}', 'input', 'body'],
      ],
      [
        'an Event’s body',
        aService({ events: { 'OrderPlaced@1': { ...anEvent, body: aRef('missing') } } }),
        ['events', 'OrderPlaced@1', 'body'],
      ],
      [
        'a code’s body',
        aService({ codes: { [gone]: { ...aCode, body: aRef('missing') } } }),
        ['codes', 'GONE', 'body'],
      ],
      [
        'a Guard’s context',
        aService({ guards: { apiKey: { ...aGuard, context: aRef('missing') } } }),
        ['guards', 'apiKey', 'context'],
      ],
      [
        'a Definitions Package’s shared schema',
        aDefinitions({ exports: schemaExports({ money: aRef('missing') }) }),
        ['exports', 'money', 'schema'],
      ],
      [
        'a Guard’s qualifier',
        aService({ guards: { apiKey: { ...aGuard, qualifier: aRef('missing') } } }),
        ['guards', 'apiKey', 'qualifier'],
      ],
      [
        'a Guard’s demanded headers',
        aService({
          guards: {
            apiKey: {
              ...aGuard,
              demands: { headers: anObjectOf(aRef('missing')), query: emptyPart },
            },
          },
        }),
        ['guards', 'apiKey', 'demands', 'headers', 'fields', 'name'],
      ],
      [
        'an Endpoint’s success headers',
        aService({
          endpoints: {
            'GET /orders/{}': {
              ...anEndpoint,
              success: { status: 200, headers: anObjectOf(aRef('missing')), body: null },
            },
          },
        }),
        ['endpoints', 'GET /orders/{}', 'success', 'headers', 'fields', 'name'],
      ],
      [
        'the invalid-input code’s body',
        aService({
          codes: {
            ...standardCodes,
            [invalidInputCode]: { ...standardCodes[invalidInputCode], body: aRef('missing') },
          },
        }),
        ['codes', 'INVALID_INPUT', 'body'],
      ],
      [
        'a Command’s body',
        aService({ commands: { 'ChargeCard@1': { ...aCommand, body: aRef('missing') } } }),
        ['commands', 'ChargeCard@1', 'body'],
      ],
    ])(
      'a ref in %s to a def the Snapshot does not hold is malformed at the ref',
      (_, snapshot, at) => {
        const result = roundTrip(snapshot);

        expect(result).toEqual(malformedAt(at));
      },
    );

    test.each(['toString', 'constructor', 'hasOwnProperty'])(
      'a name that only an Object inherits is no name the Snapshot holds: %s',
      (name) => {
        const attaching = {
          ...anEndpoint,
          rejections: [name],
          guards: [{ guard: name, qualifier: null }],
        };

        const ref = serviceWith({ defs: { tree: aRef(name) } });
        const code = serviceWith({ endpoints: { 'GET /orders/{}': { ...attaching, guards: [] } } });
        const guard = serviceWith({
          endpoints: { 'GET /orders/{}': { ...attaching, rejections: [] } },
        });

        expect([ref, code, guard]).toEqual([
          malformedAt(['defs', 'tree']),
          malformedAt(['endpoints', 'GET /orders/{}', 'rejections', 0]),
          malformedAt(['endpoints', 'GET /orders/{}', 'guards', 0, 'guard']),
        ]);
      },
    );

    test('a code an Endpoint or a Guard lists that codes does not hold is malformed', () => {
      const listing = { ...anEndpoint, rejections: ['ORDER_LOCKED'] };
      const guard = { ...aGuard, rejections: ['UNAUTHENTICATED'] };

      const endpoint = serviceWith({ endpoints: { 'GET /orders/{}': listing } });
      const serviceGuard = serviceWith({ guards: { apiKey: guard } });
      const definitionsGuard = decodedFrom({ ...aDefinitions(), guards: { apiKey: guard } });

      expect(endpoint).toEqual(malformedAt(['endpoints', 'GET /orders/{}', 'rejections', 0]));
      expect(serviceGuard).toEqual(malformedAt(['guards', 'apiKey', 'rejections', 0]));
      expect(definitionsGuard).toEqual(malformedAt(['guards', 'apiKey', 'rejections', 0]));
    });

    test.each(['invalidInput', 'notFound', 'notImplemented'])(
      'a Standard Rejection naming a code the Snapshot does not hold is malformed at its name: %s',
      (name) => {
        const named = { ...standardRejections, [name]: 'NOPE' };

        const service = serviceWith({ standardRejections: named });
        const definitions = decodedFrom({ ...aDefinitions(), standardRejections: named });

        const malformed = malformedAt(
          ['standardRejections', name],
          'names a code the Snapshot does not hold: NOPE',
        );
        expect([service, definitions]).toEqual([malformed, malformed]);
      },
    );

    test.each([
      { name: 'an Endpoint', section: 'endpoints', key: 'GET /orders/{}', declared: anEndpoint },
      { name: 'an Event', section: 'events', key: 'OrderPlaced@1', declared: anEvent },
      { name: 'a Command', section: 'commands', key: 'ChargeCard@1', declared: aCommand },
      {
        name: 'a Subscription',
        section: 'subscriptions',
        key: 'notifyOnPlaced',
        declared: {
          group: 'orders',
          description: 'Receives it',
          event: 'orders-service:OrderPlaced@1',
        },
      },
    ])('$name whose Group the Snapshot does not hold is malformed at its group', (element) => {
      const { section, key, declared } = element;

      const result = serviceWith({ [section]: { [key]: { ...declared, group: 'payments' } } });

      const reason = 'names a Group the Snapshot does not hold: payments';
      expect(result).toEqual(malformedAt([section, key, 'group'], reason));
    });

    test('a Snapshot whose Elements are all tombstones holds no Group and decodes', () => {
      const tombstones = {
        groups: {},
        endpoints: { 'GET /orders/{}': endpointTombstone },
        events: { 'OrderPlaced@1': messageTombstone },
        commands: { 'ChargeCard@1': messageTombstone },
        subscriptions: {
          legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' },
        },
      };

      const result = serviceWith(tombstones);

      expect(result.kind).toBe('decoded');
    });

    test('a Group the Snapshot holds and no Element names decodes', () => {
      const result = serviceWith({
        groups: { orders: { description: 'Orders' }, spare: { description: 'Spare' } },
      });

      expect(result.kind).toBe('decoded');
    });

    test.each([
      ['no description', { orders: {} }],
      ['a description that is no text', { orders: { description: 1 } }],
      ['a key it does not define', { orders: { description: 'Orders', tags: [] } }],
    ])('a Group with %s is malformed at the Group', (_name, groups) => {
      const result = serviceWith({ groups });

      expect(elementOf(result)).toEqual(['groups', 'orders']);
    });

    test('a Service without groups is malformed at groups: it is missing', () => {
      const { groups: _groups, ...withoutGroups } = aService();

      const result = decodedFrom(withoutGroups);

      expect(result).toEqual(malformedAt(['groups'], 'is missing'));
    });

    test('a Guard an Endpoint attaches, or a Guard lists, that guards does not hold is malformed', () => {
      const attaching = { ...anEndpoint, guards: [{ guard: 'apiKey', qualifier: null }] };

      const attached = serviceWith({ endpoints: { 'GET /orders/{}': attaching } });
      const listed = serviceWith({ guards: { admin: { ...aGuard, guards: ['apiKey'] } } });

      expect(attached).toEqual(malformedAt(['endpoints', 'GET /orders/{}', 'guards', 0, 'guard']));
      expect(listed).toEqual(malformedAt(['guards', 'admin', 'guards', 0]));
    });

    describe('a def that leads back to itself with no node between', () => {
      const reason = 'leads back to itself through refs, unions and allOfs alone';

      test.each([
        ['a ref', aRef('node')],
        ['a union with a ref to itself', { type: 'union', options: [aRef('node'), stringNode] }],
        [
          'a union with a nullable ref to itself',
          { type: 'union', options: [{ ...aRef('node'), nullable: true }, stringNode] },
        ],
        ['an allOf with itself', { type: 'allOf', items: [anObjectOf(stringNode), aRef('node')] }],
        [
          'a union with itself in a nested union',
          { type: 'union', options: [{ type: 'union', options: [aRef('node'), stringNode] }] },
        ],
      ])('a def that is %s is malformed at the def', (_, def) => {
        const result = serviceWith({ defs: { node: def } });

        expect(result).toEqual(malformedAt(['defs', 'node'], reason));
      });

      test('two defs that are refs to each other are malformed at the first', () => {
        const result = serviceWith({ defs: { a: aRef('b'), b: aRef('a') } });

        expect(result).toEqual(malformedAt(['defs', 'a'], reason));
      });

      test('two unions that are options of each other are malformed at the first', () => {
        const first = { type: 'union', options: [aRef('second'), stringNode] };
        const second = { type: 'union', options: [aRef('first'), { type: 'number' }] };

        const result = serviceWith({ defs: { first, second } });

        expect(result).toEqual(malformedAt(['defs', 'first'], reason));
      });

      test('a def that only reaches the cycle is skipped, and the first def on it is malformed', () => {
        const result = serviceWith({ defs: { c: aRef('a'), a: aRef('b'), b: aRef('a') } });

        expect(result).toEqual(malformedAt(['defs', 'a']));
      });

      test('a Definitions Package’s def that is a ref to itself is malformed at the def', () => {
        const result = decodedFrom({ ...aDefinitions(), defs: { node: aRef('node') } });

        expect(result).toEqual(malformedAt(['defs', 'node']));
      });

      test('a def naming a def the Snapshot does not hold is reported before the cycle', () => {
        const result = serviceWith({ defs: { a: aRef('a'), b: aRef('missing') } });

        expect(result).toEqual(malformedAt(['defs', 'b']));
      });
    });

    test.each<[string, SchemaNode]>([
      ['a string whose min passes its max', { type: 'string', min: 5, max: 3 }],
      ['an array whose min passes its max', { type: 'array', items: stringNode, min: 2, max: 1 }],
      ['a number whose min passes its max', { type: 'number', min: 5, max: 3 }],
      ['a number bounded exclusively at one value', { type: 'number', exclusiveMin: 5, max: 5 }],
      ['a multipleOf of 0', { type: 'number', multipleOf: 0 }],
      ['a negative string length', { type: 'string', min: -1 }],
      ['a fractional array length', { type: 'array', items: stringNode, max: 1.5 }],
    ])('%s is malformed at the node', (_name, node) => {
      const result = serviceWith({ defs: { a: node } });

      expect(result).toEqual(malformedAt(['defs', 'a']));
    });

    test('a record key whose min passes its max is malformed at the key', () => {
      const node = { type: 'record', key: { type: 'string', min: 5, max: 3 }, value: stringNode };

      const result = serviceWith({ defs: { a: node } });

      expect(result).toEqual(malformedAt(['defs', 'a', 'key']));
    });

    test('a node bounded at one value decodes', () => {
      const result = serviceWith({ defs: { a: { type: 'number', min: 5, max: 5 } } });

      expect(result.kind).toBe('decoded');
    });

    test.each<[string, object, string]>([
      ['an enum without values', { type: 'enum', values: [], open: false }, 'values'],
      ['a union without options', { type: 'union', options: [] }, 'options'],
      [
        'a tagged node without variants',
        { type: 'tagged', discriminator: 'k', variants: {} },
        'variants',
      ],
    ])('%s is malformed', (_name, node, key) => {
      const result = serviceWith({ defs: { a: node } });

      expect(result).toEqual(malformedAt(['defs', 'a', key]));
    });

    test('a Dependency’s against that is not a semantic version is malformed', () => {
      const dependencies = { 'payments-service': { against: 'not-a-version', endpoints: [] } };

      const result = serviceWith({ dependencies });

      expect(result).toEqual(malformedAt(['dependencies', 'payments-service', 'against']));
    });

    test('a Dependency without an against is malformed at the against: it is missing', () => {
      const dependencies = { 'payments-service': { endpoints: [] } };

      const result = serviceWith({ dependencies });

      expect(result).toEqual(
        malformedAt(['dependencies', 'payments-service', 'against'], 'is missing'),
      );
    });

    test('a deprecatedAt on an Active Endpoint is malformed in the Endpoint', () => {
      const endpoint = { ...anEndpoint, deprecatedAt: '2026-10-17T09:30:00Z' };

      const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

      expect(elementOf(result)).toEqual(['endpoints', 'GET /orders/{}']);
    });

    test.each([
      ['out of order', [orderLocked, gone]],
      ['with a code twice', [gone, gone]],
    ])('an Endpoint’s rejections %s are malformed in the Endpoint', (_name, rejections) => {
      const endpoint = { ...anEndpoint, rejections };
      const codes = { ...standardCodes, [orderLocked]: aCode, [gone]: aCode };

      const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint }, codes });

      expect(elementOf(result)).toEqual(['endpoints', 'GET /orders/{}']);
    });

    test('a Guard’s rejections out of order are malformed at its rejections', () => {
      const guard = { ...aGuard, rejections: [unauthenticated, gone] };
      const codes = { ...standardCodes, [unauthenticated]: aCode, [gone]: aCode };

      const result = serviceWith({ guards: { apiKey: guard }, codes });

      expect(result).toEqual(malformedAt(['guards', 'apiKey', 'rejections']));
    });

    test('a Dependency’s endpoints out of id order are malformed at its endpoints', () => {
      const endpoints = [
        { id: 'POST /payments', name: 'charge' },
        { id: 'GET /payments/{}', name: 'getPayment' },
      ];
      const dependencies = { 'payments-service': { against: '5.1.0', endpoints } };

      const result = serviceWith({ dependencies });

      expect(result).toEqual(malformedAt(['dependencies', 'payments-service', 'endpoints']));
    });

    test.each<[string, object, string]>([
      ['enum values', { type: 'enum', values: ['b', 'a'], open: false }, 'values'],
      ['enum values with one twice', { type: 'enum', values: ['a', 'a'], open: false }, 'values'],
      ['allOf items', { type: 'allOf', items: [{ type: 'string' }, { type: 'json' }] }, 'items'],
    ])('%s out of canonical order are malformed', (_name, node, key) => {
      const result = serviceWith({ defs: { a: node } });

      expect(result).toEqual(malformedAt(['defs', 'a', key]));
    });

    test('a union’s options in any order decode', () => {
      const node = { type: 'union', options: [{ type: 'string' }, { type: 'boolean' }] };
      const reversed = { type: 'union', options: [{ type: 'boolean' }, { type: 'string' }] };

      const results = [serviceWith({ defs: { a: node } }), serviceWith({ defs: { a: reversed } })];

      expect(results.map(({ kind }) => kind)).toEqual(['decoded', 'decoded']);
    });

    test.each<[string, object]>([
      ['a precision that is no integer', { format: 'datetime', formatOptions: { precision: 'x' } }],
      ['an offset that is no boolean', { format: 'datetime', formatOptions: { offset: 1 } }],
      ['a version that is no string', { format: 'uuid', formatOptions: { version: 4 } }],
      ['a protocol that is no regex', { format: 'url', formatOptions: { protocol: 'https' } }],
    ])('a string format option of the wrong type is malformed: %s', (_name, options) => {
      const result = serviceWith({ defs: { a: { type: 'string', ...options } } });

      expect(result.kind).toBe('malformed');
    });

    test('a string format option of its type decodes', () => {
      const protocol = { source: '^https$', flags: '' };
      const node = { type: 'string', format: 'url', formatOptions: { protocol } };

      expect(serviceWith({ defs: { a: node } }).kind).toBe('decoded');
    });

    test.each([4.5, 399, 500, 200])('a code status of %s is malformed at its status', (status) => {
      const codes = { ...standardCodes, [orderLocked]: { ...aCode, status } };

      const result = serviceWith({ codes });

      expect(result).toEqual(malformedAt(['codes', orderLocked, 'status']));
    });

    test('501 on a code that is neither the not-implemented one nor removed is malformed', () => {
      const codes = { ...standardCodes, [orderLocked]: { ...aCode, status: 501 } };

      const result = serviceWith({ codes });

      expect(result).toEqual(malformedAt(['codes', orderLocked, 'status']));
    });

    test('501 on a removed code, as publish carries a former not-implemented code, decodes', () => {
      const { version: _version, ...declared } = aService();
      const proposed: ServiceSnapshot = {
        ...declared,
        endpoints: {},
        events: {},
        commands: {},
        subscriptions: {},
        standardRejections: { ...standardRejections, notImplemented: gone },
        codes: {
          [invalidInputCode]: standardCodes[invalidInputCode],
          [notFoundCode]: standardCodes[notFoundCode],
          [gone]: standardCodes[notImplementedCode],
        },
      };
      const published = publishedSnapshotOf(aService(), proposed, publishedAt('3.5.0'));

      const result = roundTrip(published);

      expect(published.codes[notImplementedCode]).toMatchObject({
        status: 501,
        removedIn: '3.5.0',
      });
      expect(result.kind).toBe('decoded');
    });

    test.each(['3', '3.2', 'v3.2.0', 'soon', 3, null])(
      'a code whose removedIn is %j is malformed at removedIn',
      (removedIn) => {
        const codes = { ...standardCodes, [gone]: { ...aCode, status: 410, removedIn } };

        const result = serviceWith({ codes });

        expect(result).toEqual(malformedAt(['codes', gone, 'removedIn']));
      },
    );

    test('a Success status no Endpoint may declare is malformed in the Endpoint', () => {
      const endpoint = { ...anEndpoint, success: { ...anEndpoint.success, status: 299 } };

      const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

      expect(elementOf(result)).toEqual(['endpoints', 'GET /orders/{}']);
    });

    test('a Snapshot nested past 256 levels is malformed at its deepest path, before its structure is read', () => {
      const depth = 300;
      const nested =
        '{"type":"array","items":'.repeat(depth) + '{"type":"nothing"}' + '}'.repeat(depth);
      const text = JSON.stringify(aService()).replace('"defs":{}', `"defs":{"a":${nested}}`);

      const result = decodeSnapshot(text);

      const at = ['defs', 'a', ...Array<string>(254).fill('items')];
      expect(result).toEqual(malformedAt(at, 'nests deeper than 256 levels'));
    });

    test('a Snapshot nested to 256 levels is read', () => {
      const depth = 253;
      const nested =
        '{"type":"array","items":'.repeat(depth) + '{"type":"string"}' + '}'.repeat(depth);
      const text = JSON.stringify(aService()).replace('"defs":{}', `"defs":{"a":${nested}}`);

      expect(decodeSnapshot(text).kind).toBe('decoded');
    });

    test('only the first problem is reported, with its path', () => {
      const result = serviceWith({
        version: 'latest',
        extra: true,
        defs: { tree: aRef('missing') },
        events: { 'OrderPlaced@0': anEvent },
      });

      expect(result).toEqual({ kind: 'malformed', at: ['version'], reason: expect.any(String) });
    });

    test('the names a Snapshot uses are judged after its structure, a ref before a listed code', () => {
      const result = serviceWith({
        defs: { tree: aRef('missing') },
        endpoints: { 'GET /orders/{}': { ...anEndpoint, rejections: ['ORDER_LOCKED'] } },
      });

      expect(result).toEqual(malformedAt(['defs', 'tree']));
    });
  });
});

/** The Snapshot `generate` writes for a small Contract, as the registry's Baseline starts from it. */
function declaredSnapshot() {
  const unauthenticated = defineRejection({ code: 'UNAUTHENTICATED', status: 401, message: 'No' });
  const apiKey = defineGuard({
    name: 'apiKey',
    description: 'An API key',
    demands: { headers: z.object({ 'x-api-key': z.string() }) },
    rejections: [unauthenticated],
  });
  const getOrder = defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'One order',
    guards: [apiKey],
    input: { params: z.object({ orderId: z.uuid() }) },
    success: { status: 200, body: z.object({ id: z.uuid(), placedAt: z.iso.datetime() }) },
  });
  const orderPlaced = defineEvent({
    name: 'OrderPlaced',
    version: 1,
    visibility: 'internal',
    description: 'An order was placed',
    body: z.object({ id: z.uuid() }),
  });
  const chargeCard = defineCommand({
    name: 'ChargeCard',
    version: 1,
    description: 'Charges the card',
    body: z.object({ amount: z.int() }),
  });
  const paymentSettledV1 = providedEvent('payments-service', {
    name: 'PaymentSettled',
    version: 1,
    visibility: 'internal',
    description: 'A payment was settled',
    body: z.object({ id: z.uuid() }),
  });
  const payments = {
    name: 'payments-service',
    version: '5.1.0',
    endpoints: {},
    events: { paymentSettledV1 },
    standardRejections: {
      invalidInput: {
        code: 'INVALID_INPUT',
        status: 400,
        message: 'Invalid input',
        body: z.object({ issues: z.array(z.unknown()) }),
      },
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
    },
    exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
  } as const satisfies ContractPackage;
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] });
  const root = defineService({
    name: 'orders-service',
    groups: [
      group,
      defineGroup({
        name: 'messages',
        description: 'Messages',
        events: [orderPlaced],
        commands: [chargeCard],
        subscriptions: [
          defineSubscription({
            name: 'notifyOnPlaced',
            description: 'Receives it',
            event: orderPlaced,
          }),
          defineSubscription({
            name: 'notifyOnSettled',
            description: 'Receives it',
            event: payments.events.paymentSettledV1,
          }),
        ],
      }),
    ],
    dependencies: [defineDependency({ provider: payments })],
  });
  const validated = validateRoot(root, aRootPackage(root, { packageName: 'orders-service' }));
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  return snapshotOf(validated);
}

const formatOneFixture = `{
  "codes": {
    "GONE": { "body": null, "message": "Gone", "origin": "local", "removedIn": "3.2.0", "status": 410 },
    "INVALID_INPUT": {
      "body": { "fields": {}, "type": "object" },
      "message": "Invalid",
      "origin": "standard",
      "status": 400
    },
    "NOT_FOUND": { "body": null, "message": "Not found", "origin": "standard", "status": 404 },
    "NOT_IMPLEMENTED": { "body": null, "message": "No", "origin": "standard", "status": 501 }
  },
  "commands": { "PurgeOrders@1": { "lifecycle": "retired", "retiredIn": "3.1.0" } },
  "defs": {},
  "dependencies": {
    "payments-service": {
      "against": "5.1.0",
      "endpoints": [{ "id": "GET /payments/{}", "name": "getPayment" }]
    }
  },
  "endpoints": {
    "DELETE /orders/{}": { "lifecycle": "retired", "name": "purgeOrders", "retiredIn": "3.0.0" },
    "GET /orders/{}": {
      "deprecatedAt": "2026-10-17T09:30:00Z",
      "description": "One order",
      "group": "orders",
      "guards": [{ "guard": "apiKey", "qualifier": null }],
      "input": {
        "body": null,
        "headers": { "fields": {}, "type": "object" },
        "params": {
          "fields": { "orderId": { "required": true, "schema": { "type": "string" } } },
          "type": "object"
        },
        "query": { "fields": {}, "type": "object" }
      },
      "lifecycle": "deprecated",
      "name": "getOrder",
      "params": ["orderId"],
      "rejections": ["INVALID_INPUT", "NOT_FOUND", "NOT_IMPLEMENTED"],
      "success": { "body": null, "headers": { "fields": {}, "type": "object" }, "status": 200 },
      "visibility": "public"
    }
  },
  "events": {
    "OrderPlaced@1": {
      "body": { "fields": {}, "type": "object" },
      "description": "An order was placed",
      "group": "orders",
      "lifecycle": "active",
      "visibility": "internal"
    }
  },
  "format": 1,
  "generator": "@cf-loom/cli@2.1.0",
  "groups": { "orders": { "description": "Order lifecycle" } },
  "guards": {
    "apiKey": {
      "context": null,
      "demands": { "headers": { "fields": {}, "type": "object" }, "query": { "fields": {}, "type": "object" } },
      "description": "An API key",
      "guards": [],
      "origin": "local",
      "qualifier": null,
      "rejections": []
    }
  },
  "kind": "service",
  "name": "orders-service",
  "standardRejections": {
    "invalidInput": "INVALID_INPUT",
    "notFound": "NOT_FOUND",
    "notImplemented": "NOT_IMPLEMENTED"
  },
  "subscriptions": {
    "legacySync": { "event": "orders-service:OrderPlaced@1", "removedIn": "3.2.0" },
    "notifyOnPlaced": {
      "description": "Receives it",
      "event": "payments-service:PaymentSettled@1",
      "group": "orders"
    }
  },
  "version": "3.4.0"
}
`;

describe('walkSchemas and decodeSnapshot agree on bounds', () => {
  type Drawn = { readonly schema: z.ZodType; readonly node: SchemaNode; readonly empty: boolean };

  test('a node is refused by both exactly when its bounds admit no value', () => {
    const next = seededNext(222);
    for (let draw = 0; draw < 500; draw += 1) {
      const { schema, node, empty } = aBoundedDraw(next);

      const [walked] = walkSchemas([{ at: ['body'], schema }], () => undefined).located;
      const decoded = serviceWith({ defs: { a: node } });

      const label = `draw ${draw}: ${JSON.stringify(node)}`;
      expect(walked?.walked.kind, label).toBe(empty ? 'not-allowed' : 'walked');
      expect(decoded.kind, label).toBe(empty ? 'malformed' : 'decoded');
    }
  });

  function pick<Value>(next: () => number, values: readonly Value[]): Value {
    return values[Math.floor(next() * values.length)] as Value;
  }

  function aBoundedDraw(next: () => number): Drawn {
    const kind = pick(next, ['number', 'string', 'array'] as const);
    return kind === 'number' ? aNumberDraw(next) : aLengthDraw(next, kind);
  }

  /** A number's drawn bounds: each side inclusive, exclusive or absent, and a step or none. */
  type NumberBounds = {
    readonly lower: { readonly key: 'min' | 'exclusiveMin'; readonly value: number } | undefined;
    readonly upper: { readonly key: 'max' | 'exclusiveMax'; readonly value: number } | undefined;
    readonly step: number | undefined;
  };

  function aNumberDraw(next: () => number): Drawn {
    const values = [-2, 0, 0.5, 3, 5, 5.5];
    const lowerKey = pick(next, [undefined, 'min', 'exclusiveMin'] as const);
    const upperKey = pick(next, [undefined, 'max', 'exclusiveMax'] as const);
    const lowerValue = pick(next, values);
    const upperValue = pick(next, values);
    const bounds: NumberBounds = {
      lower: lowerKey === undefined ? undefined : { key: lowerKey, value: lowerValue },
      upper: upperKey === undefined ? undefined : { key: upperKey, value: upperValue },
      step: pick(next, [undefined, -2, 0, 0.5, 3]),
    };
    return {
      schema: numberSchemaOf(bounds),
      node: numberNodeOf(bounds),
      empty: admitsNone(bounds),
    };
  }

  function numberSchemaOf({ lower, upper, step }: NumberBounds): z.ZodType {
    let schema = z.number();
    if (lower !== undefined) {
      schema = lower.key === 'min' ? schema.gte(lower.value) : schema.gt(lower.value);
    }
    if (upper !== undefined) {
      schema = upper.key === 'max' ? schema.lte(upper.value) : schema.lt(upper.value);
    }
    return step === undefined ? schema : schema.multipleOf(step);
  }

  function numberNodeOf({ lower, upper, step }: NumberBounds): SchemaNode {
    return {
      type: 'number',
      ...(lower !== undefined && { [lower.key]: lower.value }),
      ...(upper !== undefined && { [upper.key]: upper.value }),
      ...(step !== undefined && { multipleOf: step }),
    };
  }

  function admitsNone({ lower, upper, step }: NumberBounds): boolean {
    if (step !== undefined && step <= 0) {
      return true;
    }
    const low = lower && { value: lower.value, open: lower.key === 'exclusiveMin' };
    const high = upper && { value: upper.value, open: upper.key === 'exclusiveMax' };
    return !someNumberBetween(low, high);
  }

  /** Whether some number lies between two bounds, found by trying values around them. */
  function someNumberBetween(
    lower: { readonly value: number; readonly open: boolean } | undefined,
    upper: { readonly value: number; readonly open: boolean } | undefined,
  ): boolean {
    const around = [lower?.value, upper?.value].filter((value) => value !== undefined);
    const candidates = [0, ...around.flatMap((value) => [value - 0.1, value, value + 0.1])];
    return candidates.some(
      (candidate) =>
        (lower === undefined ||
          (lower.open ? candidate > lower.value : candidate >= lower.value)) &&
        (upper === undefined || (upper.open ? candidate < upper.value : candidate <= upper.value)),
    );
  }

  function aLengthDraw(next: () => number, kind: 'string' | 'array'): Drawn {
    const lengths = [undefined, -1, 0, 1, 2.5, 3, 5];
    const min = pick(next, lengths);
    const max = pick(next, lengths);
    let schema: z.ZodString | z.ZodArray<z.ZodString> =
      kind === 'string' ? z.string() : z.array(z.string());
    if (min !== undefined) {
      schema = schema.min(min);
    }
    if (max !== undefined) {
      schema = schema.max(max);
    }
    const node = {
      ...(kind === 'string' ? { type: 'string' } : { type: 'array', items: stringNode }),
      ...(min !== undefined && { min }),
      ...(max !== undefined && { max }),
    } as SchemaNode;
    const declared = [min, max].filter((length) => length !== undefined);
    const badLength = declared.some((length) => !Number.isInteger(length) || length < 0);
    const lengthsBetween = Array.from({ length: 7 }, (_, length) => length).filter(
      (length) => (min === undefined || length >= min) && (max === undefined || length <= max),
    );
    return { schema, node, empty: badLength || lengthsBetween.length === 0 };
  }
});

describe('decodeSnapshot reads what publish writes, and nothing else in order', () => {
  const examples = ['org-definitions', 'orders-service', 'billing-service'];
  const examplesDirectory = new URL('../../../../examples/', import.meta.url);

  /** Each example's committed Snapshot published at a version, and the format-1 fixture. */
  function publishedSnapshots(): readonly (readonly [string, PublishedSnapshot])[] {
    const published = examples.map((example) => {
      const file = new URL(`${example}/contract.snapshot.json`, examplesDirectory);
      const declared: Snapshot = JSON.parse(readFileSync(file, 'utf8'));
      return [example, publishedSnapshotOf(undefined, declared, publishedAt('1.0.0'))] as const;
    });
    return [...published, ['the format-1 fixture', JSON.parse(formatOneFixture)]];
  }

  /** Where a Snapshot holds an array whose order means nothing, by what holds it. */
  function orderFreeArraysOf(json: unknown, at: Path = []): readonly Path[] {
    if (typeof json !== 'object' || json === null) {
      return [];
    }
    const own = Array.isArray(json) ? [] : orderFreeKeysOf(json, at).map((key) => [...at, key]);
    const entries = Object.entries(json);
    const nested = entries.flatMap(([key, value]) => orderFreeArraysOf(value, [...at, key]));
    return [...own, ...nested];
  }

  function orderFreeKeysOf(object: object, at: Path): readonly string[] {
    const type = Reflect.get(object, 'type');
    const section = at.length === 2 ? at[0] : undefined;
    return [
      ...(type === 'enum' ? ['values'] : []),
      ...(type === 'allOf' ? ['items'] : []),
      ...(section === 'endpoints' || section === 'guards' ? ['rejections'] : []),
      ...(section === 'dependencies' ? ['endpoints'] : []),
    ].filter((key) => Array.isArray(Reflect.get(object, key)));
  }

  /** A copy of a Snapshot's JSON with the array at a path replaced by what `change` makes of it. */
  function withArrayAt(json: unknown, at: Path, change: (items: unknown[]) => unknown[]): unknown {
    const copy: unknown = structuredClone(json);
    let holder = copy;
    for (const key of at.slice(0, -1)) {
      holder = Reflect.get(holder as object, key);
    }
    const key = String(at.at(-1));
    Reflect.set(holder as object, key, change([...(Reflect.get(holder as object, key) as [])]));
    return copy;
  }

  function arrayAt(json: unknown, at: Path): readonly unknown[] {
    let value = json;
    for (const key of at) {
      value = Reflect.get(value as object, key);
    }
    return value as readonly unknown[];
  }

  test('an intersection of a schema with itself, as generate writes it, decodes', () => {
    const schema = z.intersection(z.string(), z.string());
    const [located] = walkSchemas([{ at: ['defs', 'a'], schema }], () => undefined).located;
    const node = located?.walked.kind === 'walked' ? located.walked.value : undefined;
    const published = aService({ defs: { a: node ?? { type: 'json' } } });

    const result = roundTrip(published);

    expect(node?.type).toBe('allOf');
    expect(result).toEqual({ kind: 'decoded', snapshot: published });
  });

  /** A Snapshot holding a walked schema as a def, published, or `undefined` when it does not walk or is nullable, which no def is. */
  function publishedHolding(committed: ServiceSnapshot, schema: z.ZodType) {
    const walk = walkSchemas([{ at: ['defs', 'probe'], schema }], () => undefined);
    const [located] = walk.located;
    if (located?.walked.kind !== 'walked' || located.walked.value.nullable === true) {
      return undefined;
    }
    const defs = { ...committed.defs, ...walk.defs, probe: located.walked.value };
    return publishedSnapshotOf(undefined, { ...committed, defs }, publishedAt('1.0.0'));
  }

  /** What the decoder makes of each order-free array of the probe def reversed or holding an item twice. */
  function reorderedKindsOf(published: PublishedSnapshot): readonly string[] {
    const arrays = orderFreeArraysOf(published).filter(
      (at) => at[0] === 'defs' && at[1] === 'probe' && arrayAt(published, at).length > 0,
    );
    const twice = arrays.map((at) => withArrayAt(published, at, (list) => [...list, list[0]]));
    const reversible = arrays.filter((at) => arrayAt(published, at).length > 1);
    const reversed = reversible.map((at) => withArrayAt(published, at, (list) => list.reverse()));
    return [...twice, ...reversed].map((json) => decodeSnapshot(JSON.stringify(json)).kind);
  }

  test('random schemas a Snapshot holds decode to the same bytes, and nothing else in order', () => {
    const file = new URL('orders-service/contract.snapshot.json', examplesDirectory);
    const committed: ServiceSnapshot = JSON.parse(readFileSync(file, 'utf8'));
    const { schemaOf } = randomSchemas(seededNext(2231));
    const drawn = Array.from({ length: 2000 }, () => publishedHolding(committed, schemaOf(3)));
    const published = drawn.filter((snapshot) => snapshot !== undefined).slice(0, 200);

    const readBack = published.map((snapshot) => {
      const decoded = decodeSnapshot(canonicalTextOf(snapshot));
      return decoded.kind === 'decoded' ? canonicalTextOf(decoded.snapshot) : decoded;
    });
    const reordered = published.flatMap(reorderedKindsOf);

    expect(published).toHaveLength(200);
    expect(readBack).toEqual(published.map(canonicalTextOf));
    expect(reordered.length).toBeGreaterThan(50);
    expect(new Set(reordered)).toEqual(new Set(['malformed']));
  });

  test.each(publishedSnapshots())('%s decodes as it was published', (_name, published) => {
    const result = decodeSnapshot(canonicalTextOf(published));

    expect(result).toEqual({ kind: 'decoded', snapshot: published });
  });

  test.each(publishedSnapshots())(
    '%s is malformed with any order-free array reversed or holding an item twice',
    (_name, published) => {
      const arrays = orderFreeArraysOf(published).filter((at) => arrayAt(published, at).length > 0);
      const reversible = arrays.filter((at) => arrayAt(published, at).length > 1);
      const changed = [
        ...arrays.map((at) => withArrayAt(published, at, (list) => [...list, list[0]])),
        ...reversible.map((at) => withArrayAt(published, at, (list) => list.reverse())),
      ];

      const kinds = changed.map((json) => decodeSnapshot(JSON.stringify(json)).kind);

      expect(arrays.length).toBeGreaterThan(0);
      expect(new Set(kinds)).toEqual(new Set(['malformed']));
    },
  );
});
