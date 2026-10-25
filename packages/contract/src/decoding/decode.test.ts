import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineSubscription,
} from '../index.ts';
import {
  canonicalTextOf,
  type DecodedSnapshot,
  decodeSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  type GuardSnapshot,
  type ObjectNode,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type RefNode,
  type SchemaNode,
  schemaOriginsOf,
  snapshotOf,
  validateContract,
} from '../internal/index.ts';

const standardRejections: PublishedServiceSnapshot['standardRejections'] = {
  invalidInput: {
    origin: 'standard',
    code: 'INVALID_INPUT',
    status: 400,
    message: 'Invalid',
    body: { type: 'object', mode: 'strict', fields: {} },
  },
  notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { origin: 'standard', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
};

function aService(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    version: '3.4.0',
    generator: '@cf-loom/cli@2.1.0',
    definitions: {},
    standardRejections,
    defs: {},
    endpoints: {},
    events: {},
    commands: {},
    guards: {},
    codes: {},
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
    schemas: {},
    guards: {},
    codes: {},
    ...fields,
  };
}

const anEndpoint = {
  name: 'getOrder',
  group: 'orders',
  visibility: 'public',
  lifecycle: 'active',
  description: 'One order',
  params: ['orderId'],
  guards: [],
  input: { params: null, query: null, headers: null, body: null },
  success: { status: 200, headers: null, body: null },
  rejections: [],
} as const satisfies EndpointSnapshot;

const anEvent = {
  group: 'orders',
  visibility: 'internal',
  lifecycle: 'active',
  description: 'An order was placed',
  body: { type: 'object', mode: 'strict', fields: {} },
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
  demands: { headers: null, query: null },
  context: null,
  rejections: [],
} as const satisfies GuardSnapshot;

const orderLocked = 'ORDER_LOCKED';
const unauthenticated = 'UNAUTHENTICATED';
const gone = 'GONE';

const aCode = { origin: 'local', status: 409, message: 'Locked', body: null, removed: false };

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
  return { type: 'object', mode: 'open', fields: { name: { required: true, schema } } };
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
  mode: 'open',
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
    one: { required: true, schema: { type: 'literal', value: 'a' } },
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
            mode: 'strict',
            fields: { kind: { required: true, schema: { type: 'literal', value: 'a' } } },
          },
          '"b"': aRef('tree'),
        },
      },
    },
    both: {
      required: true,
      schema: { type: 'allOf', items: [{ type: 'string' }, { type: 'json' }] },
    },
  },
};

const treeDef: SchemaNode = {
  type: 'object',
  mode: 'open',
  fields: { children: { required: true, schema: { type: 'array', items: aRef('tree') } } },
};

describe('decodeSnapshot', () => {
  describe('what decodes', () => {
    test('a Service’s published Snapshot, written as canonical text, decodes to the same Snapshot', () => {
      const published = aService({
        definitions: { '@org/definitions': '4.2.0' },
        defs: { tree: treeDef },
        endpoints: {
          'GET /orders/{}': {
            ...anEndpoint,
            guards: [{ guard: 'apiKey', qualifier: ['orders:read'] }],
            input: { params: null, query: null, headers: null, body: aRef('tree') },
            rejections: ['ORDER_LOCKED'],
          },
        },
        events: { 'OrderPlaced@1': anEvent },
        commands: { 'ChargeCard@1': aCommand },
        guards: { apiKey: aGuard },
        codes: { [orderLocked]: aCode },
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

    test('a Snapshot built from a Contract decodes once it has a version', () => {
      const snapshot = declaredSnapshot();
      const published = { ...snapshot, version: '1.0.0' };

      const result = decodedFrom(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('every node type decodes, with the constraints and annotations it may carry', () => {
      const published = aService({
        defs: { tree: treeDef },
        endpoints: {
          'POST /orders': {
            ...anEndpoint,
            input: { params: null, query: null, headers: null, body: everyNode },
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
        schemas: { money: { type: 'object', mode: 'open', fields: {} } },
        guards: { apiKey: { ...aGuard, rejections: ['UNAUTHENTICATED'] } },
        codes: {
          [unauthenticated]: { ...aCode, status: 401 },
          [gone]: { ...aCode, status: 410, removed: true },
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

    test('a removed code decodes with removed true and the status and body it last had', () => {
      const body: SchemaNode = { type: 'object', mode: 'strict', fields: {} };
      const published = aService({
        codes: { [gone]: { ...aCode, status: 410, body, removed: true } },
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
        endpoints: { 'POST /orders': anEndpoint, 'GET /orders/{}': anEndpoint },
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

    test('a Snapshot too large or nested too deeply to decode is malformed at the root, never a throw', () => {
      const nested =
        '{"type":"array","items":'.repeat(5000) + '{"type":"string"}' + '}'.repeat(5000);
      const text = JSON.stringify(aService()).replace('"defs":{}', `"defs":{"a":${nested}}`);

      const result = decodeSnapshot(text);

      expect(result).toEqual(malformedAt([], 'is too large or nests too deeply to decode'));
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
        where: 'definitions',
        snapshot: { ...aService(), definitions: protoKeyed('1.0.0') },
        at: ['definitions', '__proto__'],
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
        where: 'a Definitions Package’s schemas',
        snapshot: { ...aDefinitions(), schemas: protoKeyed({ type: 'string' }) },
        at: ['schemas', '__proto__'],
      },
      {
        where: 'an object node’s fields',
        snapshot: {
          ...aService(),
          defs: {
            tree: {
              type: 'object',
              mode: 'open',
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
      const result = serviceWith({ definitions: map });

      expect(result).toEqual(malformedAt(['definitions']));
    });

    test('keys named like an Object’s own properties are kept as the keys they are', () => {
      const text: SchemaNode = { type: 'string' };
      const published = aService({
        defs: { constructor: text, toString: text, hasOwnProperty: text },
      });

      const result = roundTrip(published);

      expect(result).toEqual({ kind: 'decoded', snapshot: published });
    });

    test('a Snapshot without version is malformed at version: package writes none, only publish does', () => {
      const { version: _version, ...declared } = aService();

      const result = decodedFrom(declared);

      expect(result).toEqual(malformedAt(['version']));
    });

    test.each(['3.4', 'v3.4.0', '^3.4.0', 'latest', 340])(
      'a version that is not a semantic version is malformed at version: %s',
      (version) => {
        const result = serviceWith({ version });

        expect(result).toEqual(malformedAt(['version']));
      },
    );

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
        'an object mode',
        { defs: { tree: { type: 'object', mode: 'loose', fields: {} } } },
        ['defs', 'tree', 'mode'],
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
          mode: 'open',
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
      { name: 'notFound', rejection: standardRejections.notFound },
      { name: 'notImplemented', rejection: standardRejections.notImplemented },
    ])('a body on the $name Standard Rejection is malformed at the body', ({ name, rejection }) => {
      const withBody = { ...rejection, body: { type: 'string' } };

      const result = serviceWith({
        standardRejections: { ...standardRejections, [name]: withBody },
      });

      expect(result).toEqual(malformedAt(['standardRejections', name, 'body']));
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
          guards: { apiKey: { ...aGuard, demands: { headers: null, query: null, extra: 1 } } },
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

    test.each([
      ['a node type', { defs: { tree: { type: 'bogus' } } }, ['defs', 'tree', 'type']],
      ['a kind', { kind: 'library' }, ['kind']],
    ])('%s the format does not define says it is no value its format defines', (_, fields, at) => {
      const result = serviceWith(fields);

      expect(result).toEqual(malformedAt(at, 'is not a value its format defines'));
    });

    test('an Element that fits none of the forms an Element takes is reported at the Element, with one reason', () => {
      const endpoint = { ...anEndpoint, lifecycle: 'retired' };

      const result = serviceWith({ endpoints: { 'GET /orders/{}': endpoint } });

      expect(result).toEqual(
        malformedAt(
          ['endpoints', 'GET /orders/{}'],
          'matches none of the forms its format defines',
        ),
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
              input: { params: null, query: null, headers: null, body: aRef('missing') },
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
        aDefinitions({ schemas: { money: aRef('missing') } }),
        ['schemas', 'money'],
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
              demands: { headers: anObjectOf(aRef('missing')), query: null },
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
        'a Standard Rejection’s body',
        aService({
          standardRejections: {
            ...standardRejections,
            invalidInput: { ...standardRejections.invalidInput, body: aRef('missing') },
          },
        }),
        ['standardRejections', 'invalidInput', 'body'],
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
        ['a nullable ref', { ...aRef('node'), nullable: true }],
        ['a union with a ref to itself', { type: 'union', options: [aRef('node'), stringNode] }],
        [
          'a union with a nullable ref to itself',
          { type: 'union', options: [{ ...aRef('node'), nullable: true }, stringNode] },
        ],
        ['an allOf with itself', { type: 'allOf', items: [anObjectOf(stringNode), aRef('node')] }],
        [
          'a nullable union of itself',
          { type: 'union', options: [aRef('node'), stringNode], nullable: true },
        ],
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
  const paymentSettledV1 = defineEvent({
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
      invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
    },
    exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
  } as const satisfies ContractPackage;
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] });
  const root = defineContract({
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
  const validated = validateContract(root, {
    packageName: 'orders-service',
    originOf: schemaOriginsOf([]),
    exportsOf: () => [],
  });
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  return snapshotOf(validated, { generator: 'test', packages: [], committed: undefined, now: 0 });
}

const formatOneFixture = `{
  "codes": {
    "GONE": { "body": null, "message": "Gone", "origin": "local", "removed": true, "status": 410 },
    "INVALID_INPUT": {
      "body": { "fields": {}, "mode": "strict", "type": "object" },
      "message": "Invalid",
      "origin": "standard",
      "removed": false,
      "status": 400
    },
    "NOT_FOUND": { "body": null, "message": "Not found", "origin": "standard", "removed": false, "status": 404 },
    "NOT_IMPLEMENTED": { "body": null, "message": "No", "origin": "standard", "removed": false, "status": 501 }
  },
  "commands": { "PurgeOrders@1": { "lifecycle": "retired", "retiredIn": "3.1.0" } },
  "definitions": { "@org/definitions": "4.2.0" },
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
        "headers": { "fields": {}, "mode": "open", "type": "object" },
        "params": { "fields": {}, "mode": "strict", "type": "object" },
        "query": null
      },
      "lifecycle": "deprecated",
      "name": "getOrder",
      "params": ["orderId"],
      "rejections": ["INVALID_INPUT", "NOT_FOUND", "NOT_IMPLEMENTED"],
      "success": { "body": null, "headers": null, "status": 200 },
      "visibility": "public"
    }
  },
  "events": {
    "OrderPlaced@1": {
      "body": { "fields": {}, "mode": "open", "type": "object" },
      "description": "An order was placed",
      "group": "orders",
      "lifecycle": "active",
      "visibility": "internal"
    }
  },
  "format": 1,
  "generator": "@cf-loom/cli@2.1.0",
  "guards": {
    "apiKey": {
      "context": null,
      "demands": { "headers": { "fields": {}, "mode": "open", "type": "object" }, "query": null },
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
    "invalidInput": {
      "body": { "fields": {}, "mode": "strict", "type": "object" },
      "code": "INVALID_INPUT",
      "message": "Invalid",
      "origin": "standard",
      "status": 400
    },
    "notFound": { "code": "NOT_FOUND", "message": "Not found", "origin": "standard", "status": 404 },
    "notImplemented": { "code": "NOT_IMPLEMENTED", "message": "No", "origin": "standard", "status": 501 }
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
