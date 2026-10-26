import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
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
  removeFixtures,
  removeProjects,
  staleSnapshotLine,
  valueAt,
  write,
} from '../test/cli-project.ts';
import { usage } from '../test/usage.ts';

afterEach(removeProjects);

afterAll(removeFixtures);

const defsPrefix = '#/components/schemas/';

/** The `$ref` to a component. */
function refTo(name: string): { readonly $ref: string } {
  return { $ref: `${defsPrefix}${name}` };
}

/** The AsyncAPI channel of a Message Version. */
function channelOf(identity: string): unknown {
  return valueAt(document, 'channels', identity);
}

/** The one AsyncAPI message of a Message Version's channel. */
function messageOf(identity: string): unknown {
  return valueAt(channelOf(identity), 'messages', identity);
}

/** The payload of a Message Version's message. */
function payloadOf(identity: string): unknown {
  return valueAt(messageOf(identity), 'payload');
}

/** The AsyncAPI operation of a Message Version. */
function operationOf(identity: string): unknown {
  return valueAt(document, 'operations', identity);
}

/** A property of the body `OrderNoted@1` carries, which holds a field of each kind the Events add. */
function noted(field: string): unknown {
  return valueAt(payloadOf('OrderNoted@1'), 'properties', field);
}

/** A component of the document. */
function componentOf(name: string): unknown {
  return valueAt(document, 'components', 'schemas', name);
}

/** The `$ref` strings of a document, wherever they are. */
function refsOf(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const refs: string[] = [];
  for (const [key, found] of Object.entries(value)) {
    if (key === '$ref' && typeof found === 'string') {
      refs.push(found);
    } else {
      refs.push(...refsOf(found));
    }
  }
  return refs;
}

/** The value a `$ref` of the document points at, or `undefined` where it points at nothing. */
function targetOf(ref: string): unknown {
  return valueAt(document, ...ref.slice('#/'.length).split('/'));
}

/** The lines that declare the Events of `theService`, around the Commands and Subscription. */
const theEvents = [
  "import { defineCommand, defineService, defineEvent, defineGroup, defineSubscription } from '@cf-loom/contract';",
  "import { z } from 'zod';",
  "const tree = z.object({ label: z.string(), get children() { return z.array(tree); } }).meta({ id: 'treeNode' });",
  "const purgeNode = z.object({ get next() { return purgeNode.optional(); } }).meta({ id: 'purgeNode' });",
  'export const orderCreatedV1 = defineEvent({',
  "  name: 'OrderCreated',",
  '  version: 1,',
  "  visibility: 'internal',",
  "  description: 'An order was placed',",
  "  lifecycle: 'deprecated',",
  '  body: z.object({ orderId: z.uuid() }),',
  '});',
  'export const orderCreatedV2 = defineEvent({',
  "  name: 'OrderCreated',",
  '  version: 2,',
  "  visibility: 'internal',",
  "  description: 'An order was placed with its total',",
  '  body: z.object({ orderId: z.uuid(), total: z.int() }),',
  '});',
  'export const orderNotedV1 = defineEvent({',
  "  name: 'OrderNoted',",
  '  version: 1,',
  "  visibility: 'private',",
  "  description: 'A note was added to an order',",
  '  body: z.object({',
  '    note: z.string().describe("A note\\u2028on the order"),',
  "    root: tree.nullable().describe('The root'),",
  "    branch: z.lazy(() => tree).describe('A branch'),",
  '    pair: z.tuple([z.string()], z.number()),',
  '    triple: z.tuple([z.string(), z.number()]),',
  '    nothing: z.tuple([]),',
  '    anyNumbers: z.tuple([], z.number()),',
  "    mark: z.string().optional().meta({ examples: ['x'] }),",
  '  }),',
  '});',
  'export const orderPurgedV1 = defineEvent({',
  "  name: 'OrderPurged',",
  '  version: 1,',
  "  visibility: 'private',",
  "  description: 'An order was purged',",
  "  lifecycle: 'retired',",
  '  body: z.object({ orderId: z.uuid(), trail: purgeNode }),',
  '});',
  'export const treeGrownV1 = defineEvent({',
  "  name: 'TreeGrown',",
  '  version: 1,',
  "  visibility: 'internal',",
  "  description: 'A tree grew',",
  "  lifecycle: 'deprecated',",
  '  body: tree,',
  '});',
  'export const chargeCardV1 = defineCommand({',
  "  name: 'ChargeCard',",
  '  version: 1,',
  "  description: 'Charges a card',",
  '  body: z.object({ orderId: z.uuid() }),',
  '});',
  "export const auditCreated = defineSubscription({ name: 'auditCreated', description: 'Audit created', event: orderCreatedV2 });",
];

/**
 * A Service named `orders-service` with an Event of each Visibility and Lifecycle in the Groups
 * `trees`, `orders` and `notes`, its one Retired Event alone in `purges`, and a Command and a
 * Subscription.
 */
const theService = aContractProject([
  ...theEvents,
  "const trees = defineGroup({ name: 'trees', description: 'Trees', events: [treeGrownV1] });",
  'const orders = defineGroup({',
  "  name: 'orders',",
  "  description: 'Orders',",
  '  events: [orderCreatedV1, orderCreatedV2],',
  '  commands: [chargeCardV1],',
  '  subscriptions: [auditCreated],',
  '});',
  "const notes = defineGroup({ name: 'notes', description: 'Notes', events: [orderNotedV1] });",
  "const purges = defineGroup({ name: 'purges', description: 'Purges', events: [orderPurgedV1] });",
  "export const contract = defineService({ name: 'orders-service', groups: [trees, orders, notes, purges] });",
]);

/** A Service named `orders-service` that declares no Event. */
const aServiceWithoutEvents = aContractProject([
  "import { defineService } from '@cf-loom/contract';",
  '',
  "export const contract = defineService({ name: 'orders-service' });",
]);

/** A Service whose one Event, in the Lifecycle given, has a recursive def as its body, with a description and an example. */
function aServiceWithDescribedTree(
  lifecycle: 'active' | 'deprecated',
): Readonly<Record<string, string>> {
  return aContractProject([
    "import { defineService, defineEvent, defineGroup } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    "const tree = z.object({ label: z.string(), get children() { return z.array(tree); } }).meta({ id: 'treeNode' });",
    'export const treeGrownV1 = defineEvent({',
    `  name: 'TreeGrown', version: 1, visibility: 'internal', lifecycle: '${lifecycle}',`,
    "  description: 'A tree grew',",
    "  body: z.lazy(() => tree).meta({ description: 'The tree', examples: [{ label: 'a', children: [] }] }),",
    '});',
    "const trees = defineGroup({ name: 'trees', description: 'Trees', events: [treeGrownV1] });",
    "export const contract = defineService({ name: 'orders-service', groups: [trees] });",
  ]);
}

/** The payload of `TreeGrown@1` in the Service `aServiceWithDescribedTree` gives. */
function treeGrownPayloadOf(lifecycle: 'active' | 'deprecated'): unknown {
  const project = aGeneratedProject(aServiceWithDescribedTree(lifecycle));
  const written = JSON.parse(cfLoom(project, 'asyncapi').stdout);
  return valueAt(written, 'channels', 'TreeGrown@1', 'messages', 'TreeGrown@1', 'payload');
}

/** A Service whose Event `OrderCreated` has the versions 1 to `count`. */
function aServiceWithVersions(count: number): Readonly<Record<string, string>> {
  const versions = Array.from({ length: count }, (_none, index) => index + 1);
  const declared = versions.map((version) => [
    `export const orderCreatedV${version} = defineEvent({`,
    `  name: 'OrderCreated', version: ${version}, visibility: 'internal',`,
    "  description: 'An order was placed', body: z.object({ orderId: z.uuid() }),",
    '});',
  ]);
  const names = versions.map((version) => `orderCreatedV${version}`);
  return aContractProject([
    "import { defineService, defineEvent, defineGroup } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    ...declared.flat(),
    `const orders = defineGroup({ name: 'orders', description: 'Orders', events: [${names.join(', ')}] });`,
    "export const contract = defineService({ name: 'orders-service', groups: [orders] });",
  ]);
}

let fixture = '';
let ran: { status: number | null; stdout: string; stderr: string };
let document: unknown;

beforeAll(() => {
  fixture = aFixture(theService);
  generated(fixture);
  ran = cfLoom(fixture, 'asyncapi');
  document = JSON.parse(ran.stdout);
});

describe('cf-loom asyncapi', () => {
  test('asyncapi exits 0 and prints nothing on stderr', () => {
    expect([ran.status, ran.stderr]).toEqual([0, '']);
  });

  test('the document is AsyncAPI 3.1.0', () => {
    expect(valueAt(document, 'asyncapi')).toBe('3.1.0');
  });

  test('the document is titled with the Service’s name', () => {
    expect(valueAt(document, 'info', 'title')).toBe('orders-service');
  });

  test('the document is at version 0.0.0', () => {
    expect(valueAt(document, 'info', 'version')).toBe('0.0.0');
  });

  test('the document’s tags are the Groups of its Events that are not Retired, each once, in code point order, with their descriptions', () => {
    expect(valueAt(document, 'info', 'tags')).toEqual([
      { name: 'notes', description: 'Notes' },
      { name: 'orders', description: 'Orders' },
      { name: 'trees', description: 'Trees' },
    ]);
  });

  test('the document’s default content type is application/json', () => {
    expect(valueAt(document, 'defaultContentType')).toBe('application/json');
  });

  test('a Service that declares no Event has a document with no channel and no operation', () => {
    const project = aGeneratedProject(aServiceWithoutEvents);

    const empty = JSON.parse(cfLoom(project, 'asyncapi').stdout);

    expect([valueAt(empty, 'channels'), valueAt(empty, 'operations')]).toEqual([{}, {}]);
  });
});

describe('cf-loom asyncapi: the channels', () => {
  test('each Message Version that is not Retired is a channel keyed by its identity', () => {
    expect(keysOf(valueAt(document, 'channels'))).toEqual([
      'OrderCreated@1',
      'OrderCreated@2',
      'OrderNoted@1',
      'TreeGrown@1',
    ]);
  });

  test('a channel’s address is the Message Version’s subject', () => {
    const addresses = ['OrderCreated@1', 'OrderCreated@2', 'OrderNoted@1', 'TreeGrown@1'].map(
      (identity) => valueAt(channelOf(identity), 'address'),
    );

    expect(addresses).toEqual([
      'orders-service.event.OrderCreated.v1',
      'orders-service.event.OrderCreated.v2',
      'orders-service.event.OrderNoted.v1',
      'orders-service.event.TreeGrown.v1',
    ]);
  });

  test('the channels’ addresses are the Event subjects broker-plan puts in the Service’s stream', () => {
    const { plan } = JSON.parse(cfLoom(fixture, 'broker-plan', '--json').stdout);
    const subjects = valueAt(plan, 'streams', 'orders-service', 'subjects') as string[];
    const addresses = Object.values(valueAt(document, 'channels') as object).map((channel) =>
      valueAt(channel, 'address'),
    );

    expect(addresses).toEqual(subjects.filter((subject) => subject.includes('.event.')));
  });

  test('with --prefix, a channel’s address carries the prefix', () => {
    const prefixed = JSON.parse(cfLoom(fixture, 'asyncapi', '--prefix', 'staging').stdout);

    expect(valueAt(prefixed, 'channels', 'OrderCreated@2', 'address')).toBe(
      'staging.orders-service.event.OrderCreated.v2',
    );
  });

  test('the channels are in code point order of their identity', () => {
    const project = aGeneratedProject(aServiceWithVersions(10));

    const written = JSON.parse(cfLoom(project, 'asyncapi').stdout);

    expect(keysOf(valueAt(written, 'channels'))).toEqual([
      'OrderCreated@1',
      'OrderCreated@10',
      'OrderCreated@2',
      'OrderCreated@3',
      'OrderCreated@4',
      'OrderCreated@5',
      'OrderCreated@6',
      'OrderCreated@7',
      'OrderCreated@8',
      'OrderCreated@9',
    ]);
  });

  test('a channel holds one message, keyed by its identity', () => {
    expect(keysOf(valueAt(channelOf('OrderCreated@2'), 'messages'))).toEqual(['OrderCreated@2']);
  });

  test('a message is named by the Event’s name', () => {
    expect(valueAt(messageOf('OrderCreated@2'), 'name')).toBe('OrderCreated');
  });

  test('a message is titled by its identity', () => {
    expect(valueAt(messageOf('OrderCreated@2'), 'title')).toBe('OrderCreated@2');
  });

  test('a message’s description is the Event’s description', () => {
    expect(valueAt(messageOf('OrderCreated@2'), 'description')).toBe(
      'An order was placed with its total',
    );
  });

  test('Internal and Private Events are both written, each with its Visibility as x-cf-loom-visibility', () => {
    const visibilities = ['OrderCreated@2', 'OrderNoted@1'].map((identity) =>
      valueAt(channelOf(identity), 'x-cf-loom-visibility'),
    );

    expect(visibilities).toEqual(['internal', 'private']);
  });

  test('a Retired Message Version has no channel', () => {
    expect(valueAt(document, 'channels')).not.toHaveProperty('OrderPurged@1');
  });

  test('a Command is not written', () => {
    expect(JSON.stringify(document)).not.toContain('ChargeCard');
  });
});

describe('cf-loom asyncapi: the operations', () => {
  test('each channel has an operation keyed by the same identity', () => {
    expect(keysOf(valueAt(document, 'operations'))).toEqual(keysOf(valueAt(document, 'channels')));
  });

  test('an operation sends its channel’s message', () => {
    expect(valueAt(operationOf('OrderNoted@1'), 'action')).toBe('send');
  });

  test('a send operation refers to its channel', () => {
    expect(valueAt(operationOf('OrderCreated@2'), 'channel')).toEqual({
      $ref: '#/channels/OrderCreated@2',
    });
  });

  test('a send operation lists its channel’s message', () => {
    expect(valueAt(operationOf('OrderCreated@2'), 'messages')).toEqual([
      { $ref: '#/channels/OrderCreated@2/messages/OrderCreated@2' },
    ]);
  });

  test('a send operation is tagged with its Event’s Group', () => {
    expect(valueAt(operationOf('OrderNoted@1'), 'tags')).toEqual([{ name: 'notes' }]);
  });

  test('a Retired Message Version has no operation', () => {
    expect(valueAt(document, 'operations')).not.toHaveProperty('OrderPurged@1');
  });

  test('a Subscription adds no operation', () => {
    expect(valueAt(document, 'operations')).not.toHaveProperty('auditCreated');
  });
});

describe('cf-loom asyncapi: the payloads', () => {
  test('a message’s payload is the JSON Schema of the Event’s body', () => {
    expect(payloadOf('OrderCreated@2')).toEqual({
      type: 'object',
      properties: { orderId: { type: 'string', format: 'uuid' }, total: { type: 'integer' } },
      required: ['orderId', 'total'],
    });
  });

  test('a body’s description stays in its payload', () => {
    expect(noted('root')).toMatchObject({ description: 'The root' });
  });

  test('a body’s examples stay in its payload', () => {
    expect(noted('mark')).toEqual({ type: 'string', examples: ['x'] });
  });

  test('a tuple is items as a list, with additionalItems for its rest', () => {
    expect(noted('pair')).toEqual({
      type: 'array',
      items: [{ type: 'string' }],
      minItems: 1,
      additionalItems: { type: 'number' },
    });
  });

  test('a tuple without rest admits no other item', () => {
    expect(noted('triple')).toEqual({
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      additionalItems: false,
    });
  });

  test('an empty tuple admits no item', () => {
    expect(noted('nothing')).toEqual({ type: 'array', minItems: 0, items: false });
  });

  test('an empty tuple with rest admits any number of its rest', () => {
    expect(noted('anyNumbers')).toEqual({
      type: 'array',
      minItems: 0,
      items: { type: 'number' },
    });
  });

  test('a Deprecated Message Version’s payload is deprecated', () => {
    expect(payloadOf('OrderCreated@1')).toMatchObject({ type: 'object', deprecated: true });
  });

  test('an Active Message Version’s payload is not marked deprecated', () => {
    expect(payloadOf('OrderCreated@2')).not.toHaveProperty('deprecated');
  });

  test('a Deprecated Message Version whose body is a recursive def is deprecated', () => {
    expect(payloadOf('TreeGrown@1')).toEqual({
      allOf: [refTo('TreeNodeDef')],
      deprecated: true,
    });
  });

  test('a Deprecated Message Version whose body is a described recursive def keeps its description and examples on its payload', () => {
    expect(treeGrownPayloadOf('deprecated')).toEqual({
      allOf: [refTo('TreeNodeDef')],
      description: 'The tree',
      examples: [{ label: 'a', children: [] }],
      deprecated: true,
    });
  });

  test('an Active Message Version whose body is a described recursive def keeps its description and examples on its payload', () => {
    expect(treeGrownPayloadOf('active')).toEqual({
      allOf: [refTo('TreeNodeDef')],
      description: 'The tree',
      examples: [{ label: 'a', children: [] }],
    });
  });

  test('a described recursive def in a property keeps its description beside an allOf of its $ref', () => {
    expect(noted('branch')).toEqual({ allOf: [refTo('TreeNodeDef')], description: 'A branch' });
  });

  test('a recursive def a body reaches is written once as a component named after its type in code', () => {
    expect(componentOf('TreeNodeDef')).toEqual({
      type: 'object',
      properties: {
        children: { type: 'array', items: refTo('TreeNodeDef') },
        label: { type: 'string' },
      },
      required: ['children', 'label'],
    });
  });

  test('each use of a recursive def is a $ref to its component', () => {
    expect(noted('root')).toEqual({
      anyOf: [refTo('TreeNodeDef'), { type: 'null' }],
      description: 'The root',
    });
  });

  test('a def only a Retired Message Version reaches is not a component', () => {
    expect(valueAt(document, 'components', 'schemas')).not.toHaveProperty('PurgeNodeDef');
  });

  test('every $ref of the document names a component, a channel or a message of a channel', () => {
    const refs = refsOf(document);

    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => targetOf(ref) === undefined)).toEqual([]);
  });
});

describe('cf-loom asyncapi: the headers', () => {
  test('every message’s headers are the BrokerHeaders component', () => {
    const headers = ['OrderCreated@1', 'OrderCreated@2', 'OrderNoted@1', 'TreeGrown@1'].map(
      (identity) => valueAt(messageOf(identity), 'headers'),
    );

    expect(headers).toEqual(Array.from({ length: 4 }, () => refTo('BrokerHeaders')));
  });

  test('the broker headers require Cf-Loom-Fact-Id, a non-empty string', () => {
    const headers = componentOf('BrokerHeaders');

    expect(valueAt(headers, 'required')).toContain('Cf-Loom-Fact-Id');
    expect(valueAt(headers, 'properties', 'Cf-Loom-Fact-Id')).toMatchObject({
      type: 'string',
      minLength: 1,
    });
  });

  test('the broker headers require Nats-Msg-Id, a non-empty string', () => {
    const headers = componentOf('BrokerHeaders');

    expect(valueAt(headers, 'required')).toContain('Nats-Msg-Id');
    expect(valueAt(headers, 'properties', 'Nats-Msg-Id')).toMatchObject({
      type: 'string',
      minLength: 1,
    });
  });

  test('the broker headers describe Nats-Msg-Id as event.<Name>.v<version>:<Fact id>', () => {
    const headers = componentOf('BrokerHeaders');

    expect(valueAt(headers, 'properties', 'Nats-Msg-Id')).toMatchObject({
      description: expect.stringContaining('event.<Name>.v<version>:<Fact id>'),
    });
  });

  test('the broker headers admit any other header as a string', () => {
    expect(valueAt(componentOf('BrokerHeaders'), 'additionalProperties')).toMatchObject({
      type: 'string',
    });
  });

  test('a Service that declares no Event has no BrokerHeaders component', () => {
    const project = aGeneratedProject(aServiceWithoutEvents);

    const empty = JSON.parse(cfLoom(project, 'asyncapi').stdout);

    expect(valueAt(empty, 'components', 'schemas')).toEqual({});
  });

  test('the components are written in code point order', () => {
    expect(keysOf(valueAt(document, 'components', 'schemas'))).toEqual([
      'BrokerHeaders',
      'TreeNodeDef',
    ]);
  });
});

describe('cf-loom asyncapi: what it prints', () => {
  test('the document is JSON indented by two spaces', () => {
    const [first, second] = ran.stdout.split('\n');

    expect([first, second]).toEqual(['{', '  "asyncapi": "3.1.0",']);
  });

  test('the document ends with a final newline', () => {
    expect(ran.stdout.endsWith('}\n')).toBe(true);
  });

  test('two runs print the same bytes', () => {
    const again = cfLoom(fixture, 'asyncapi');

    expect(again.stdout).toBe(ran.stdout);
  });

  test('the document’s keys are in AsyncAPI’s usual order', () => {
    expect(keysOf(document)).toEqual([
      'asyncapi',
      'info',
      'defaultContentType',
      'channels',
      'operations',
      'components',
    ]);
  });

  test('a channel’s keys are in AsyncAPI’s usual order', () => {
    expect(keysOf(channelOf('OrderCreated@2'))).toEqual([
      'address',
      'x-cf-loom-visibility',
      'messages',
    ]);
  });

  test('a message’s keys are in AsyncAPI’s usual order', () => {
    expect(keysOf(messageOf('OrderCreated@2'))).toEqual([
      'name',
      'title',
      'description',
      'headers',
      'payload',
    ]);
  });

  test('an operation’s keys are in AsyncAPI’s usual order', () => {
    expect(keysOf(operationOf('OrderCreated@2'))).toEqual([
      'action',
      'channel',
      'tags',
      'messages',
    ]);
  });

  test('a description holding U+2028 is printed as its JSON escape and parses back to the same text', () => {
    const description = valueAt(noted('note'), 'description');

    expect(ran.stdout).not.toContain(' ');
    expect(ran.stdout).toContain('A note\\u2028on the order');
    expect(description).toBe('A note on the order');
  });

  test('asyncapi runs offline: with no npm on PATH and the registry at a dead address, it prints the document', async () => {
    const offline = await cfLoomOffline(fixture, 'asyncapi');

    expect(offline).toEqual({ status: 0, stdout: ran.stdout, stderr: '' });
  });
});

describe('cf-loom asyncapi: what it refuses', () => {
  test('asyncapi fails when contract.snapshot.json is missing, exit 1, printing no document', () => {
    const project = aProject(theService);

    const refused = cfLoom(project, 'asyncapi');

    expect(refused).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('asyncapi fails when contract.snapshot.json is out of date, exit 1, printing no document', () => {
    const project = aGeneratedProject(theService);
    write(project, aServiceWithoutEvents);

    const refused = cfLoom(project, 'asyncapi');

    expect(refused).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('a Root that breaks a rule fails asyncapi with generate’s lines', () => {
    const project = aProject({
      ...theService,
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    });

    const refused = cfLoom(project, 'asyncapi');

    expect(refused).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'src/contract/index.ts: (root) name package-name: A Root is named as its package.json, without the scope: "orders-service" is written, package.json names "billing-service"\n',
    });
  });

  test('a contract.snapshot.json that is no JSON is a tooling error', () => {
    const project = aProject({ ...theService, 'contract.snapshot.json': '<<<<<<< HEAD\n' });

    const refused = cfLoom(project, 'asyncapi');

    expect(refused.status).toBe(3);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toMatch(
      /^contract\.snapshot\.json is no JSON \([^\n]+\): run cf-loom generate\n$/,
    );
  });

  test('an Application has no AsyncAPI document, a tooling error', () => {
    const project = aProject(anApplication);

    const refused = cfLoom(project, 'asyncapi');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: 'An Application has no AsyncAPI document: only a Service publishes Events\n',
    });
  });

  test('a Definitions Package has no AsyncAPI document, a tooling error', () => {
    const project = aProject(aDefinitionsPackage);

    const refused = cfLoom(project, 'asyncapi');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: 'A Definitions Package has no AsyncAPI document: only a Service publishes Events\n',
    });
  });

  test('asyncapi takes no argument', () => {
    const project = aProject({});

    const refused = cfLoom(project, 'asyncapi', 'now');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: `asyncapi takes no argument. ${usage}\n`,
    });
  });

  test.for([
    ['a prefix with an underscore', ['--prefix', 'stag_ing']],
    ['a prefix in upper case', ['--prefix', 'Staging']],
    ['no prefix after the option', ['--prefix']],
  ] as const)('a prefix that is not kebab-case is a usage error: %s', ([_case, options]) => {
    const project = aProject({});

    const refused = cfLoom(project, 'asyncapi', ...options);

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: `--prefix takes a prefix in kebab-case, such as staging. ${usage}\n`,
    });
  });

  test.for([
    ['--out', ['--out', 'folder'], 'Only package takes --out'],
    ['--force', ['--force'], 'Only publish takes --force'],
    ['--prerelease', ['--prerelease'], 'Only check and publish take --prerelease'],
  ] as const)('asyncapi does not take %s', ([_option, options, message]) => {
    const project = aProject({});

    const refused = cfLoom(project, 'asyncapi', ...options);

    expect(refused).toEqual({ status: 3, stdout: '', stderr: `${message}. ${usage}\n` });
  });
});
