import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { pingedV1 } from '../../test/ping-package.ts';
import {
  type Construct,
  constructs,
  inField,
  type RandomSchema,
  randomNested,
  tailTextOf,
} from '../../test/random-places.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { anInstalledPackage, aRootPackage } from '../../test/root-package.ts';
import {
  defineDefinitions,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
  type Guard,
} from '../index.ts';
import {
  type ApplicationSnapshot,
  type CodeSnapshot,
  type CommandSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  failureLineOf,
  type GuardSnapshot,
  nestingFailureOf,
  type Root,
  type RootPackage,
  type SchemaNode,
  type ServiceSnapshot,
  type Snapshot,
  snapshotPathOf,
  validateRoot,
} from '../internal/index.ts';

/** The lines `generate` prints for a Root, in the package it names unless the test gives another. */
function linesOf(root: Root, given: Partial<RootPackage> = {}): readonly string[] {
  const validated = validateRoot(root, aRootPackage(root, given));
  return validated.kind === 'invalid' ? validated.failures.map(failureLineOf) : [];
}

/** An Endpoint named `name` at a route such as `GET /things/:id`, with what else it writes. */
const oneAnEndpoint = (name: string, route: string, extra: object = {}) => {
  const [method, path] = route.split(' ');
  return defineEndpoint({
    name,
    method,
    path,
    visibility: 'public',
    description: 'd',
    success: { status: 200, body: z.object({ ok: z.boolean() }) },
    ...extra,
  } as never);
};

function serviceOf(...endpoints: readonly Endpoint[]): Root {
  const [first, ...others] = endpoints;
  const group = defineGroup({
    name: 'orders',
    description: 'Orders',
    endpoints: [first as Endpoint, ...others],
  });
  return defineService({ name: 'orders-service', groups: [group] });
}

describe('failure lines: where a failure sits', () => {
  test('a failure in an Endpoint’s success body names the Endpoint and the field', () => {
    const getThing = oneAnEndpoint('getThing', 'GET /things/:id', {
      input: { params: z.object({ id: z.string() }) },
      success: { status: 200, body: z.object({ v: z.string().default('x') }) },
    });

    expect(linesOf(serviceOf(getThing))).toEqual([
      'endpoints.GET /things/{} (getThing) success.body.v not allowed: .default()',
    ]);
  });

  test('a failure in a path param names the param as written, not {}', () => {
    const getThing = oneAnEndpoint('getThing', 'GET /things/:thingId', {
      input: { params: z.object({ thingId: z.string().default('x') }) },
    });

    expect(linesOf(serviceOf(getThing))).toEqual([
      'endpoints.GET /things/{} (getThing) input.params.thingId not allowed: .default()',
    ]);
  });

  test('a failure inside a discriminated union names the variant, inside a plain union its option', () => {
    const tagged = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), at: z.date() }),
      z.object({ type: z.literal('b') }),
    ]);
    const getThing = oneAnEndpoint('getThing', 'GET /things', {
      success: {
        status: 200,
        body: z.object({ shape: tagged, either: z.union([z.string(), z.date()]) }),
      },
    });

    expect(linesOf(serviceOf(getThing))).toEqual([
      'endpoints.GET /things (getThing) success.body.shape<type="a">.at not allowed: z.date() (use z.iso.datetime())',
      'endpoints.GET /things (getThing) success.body.either<|1> not allowed: z.date() (use z.iso.datetime())',
    ]);
  });

  test('a missing visibility names the Endpoint and the key', () => {
    const noVisibility = oneAnEndpoint('createThing', 'POST /b', { visibility: undefined });

    expect(linesOf(serviceOf(noVisibility))).toEqual([
      'endpoints.POST /b (createThing) visibility required-field: visibility is a required string',
    ]);
  });

  test('an Endpoint whose name is no string is named by its Group and position', () => {
    const named = [oneAnEndpoint('first', 'GET /a'), oneAnEndpoint('second', 'GET /b')];
    const nameless = oneAnEndpoint(5 as never, 'GET /c');

    expect(linesOf(serviceOf(...named, nameless))).toEqual([
      'groups.orders endpoints[2].name not-a-string: name is a string',
    ]);
  });

  test('a Rejection header named in upper case fails at its code and the header', () => {
    const locked = defineRejection({
      code: 'LOCKED',
      status: 409,
      message: 'Locked',
      headers: z.object({ 'Retry-After': z.string() }) as never,
    });
    const lockThing = oneAnEndpoint('lockThing', 'POST /c', { rejections: [locked] });

    expect(linesOf(serviceOf(lockThing))).toEqual([
      'codes.LOCKED headers.Retry-After header-names: Header names are lower-case: Retry-After',
    ]);
  });
});

describe('failure lines: a Snapshot nested too deep', () => {
  const part = { type: 'object', fields: {} } as const;
  const standardRejections = {
    invalidInput: 'INVALID_INPUT',
    notFound: 'NOT_FOUND',
    notImplemented: 'NOT_IMPLEMENTED',
  } as const;
  const orderLocked = 'ORDER_LOCKED';
  const message = 'a schema nested deeper than the 252 levels a Snapshot holds';

  /** A schema of `containers` objects one inside the other, the innermost a string. */
  const nested = (containers: number): SchemaNode => {
    let node: SchemaNode = { type: 'string' };
    for (let level = 1; level < containers; level++) {
      node = { type: 'array', items: node };
    }
    return node;
  };

  const service = (fields: Partial<ServiceSnapshot>): ServiceSnapshot => ({
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections,
    groups: {},
    defs: {},
    endpoints: {},
    events: {},
    commands: {},
    guards: {},
    codes: {},
    subscriptions: {},
    dependencies: {},
    ...fields,
  });

  const anEndpoint = (input: Partial<EndpointSnapshot['input']>): EndpointSnapshot => ({
    name: 'getThing',
    group: 'things',
    visibility: 'public',
    lifecycle: 'active',
    description: 'd',
    params: [],
    guards: [],
    input: { params: null, query: part, headers: part, body: null, ...input },
    success: { status: 200, headers: part, body: null },
    rejections: [],
  });

  const aCode = (body: SchemaNode): CodeSnapshot => ({
    origin: 'local',
    status: 409,
    message: 'Locked',
    headers: part,
    body,
  });

  const aGuard = (context: SchemaNode): GuardSnapshot => ({
    origin: 'local',
    description: 'd',
    guards: [],
    qualifier: null,
    demands: { headers: part, query: part },
    context,
    rejections: [],
  });

  const anEvent = (body: SchemaNode): EventSnapshot => ({
    group: 'orders',
    visibility: 'internal',
    lifecycle: 'active',
    description: 'd',
    body,
  });

  const aCommand = (body: SchemaNode): CommandSnapshot => ({
    group: 'orders',
    lifecycle: 'active',
    description: 'd',
    body,
  });

  const cases = (schema: SchemaNode): readonly (readonly [string, Snapshot, string])[] => [
    [
      'an Event',
      service({ events: { 'OrderCreated@1': anEvent(schema) } }),
      'events.OrderCreated@1',
    ],
    [
      'a Command',
      service({ commands: { 'ChargeCard@1': aCommand(schema) } }),
      'commands.ChargeCard@1',
    ],
    ['a code', service({ codes: { [orderLocked]: aCode(schema) } }), 'codes.ORDER_LOCKED'],
    ['a Guard', service({ guards: { apiKey: aGuard(schema) } }), 'guards.apiKey'],
    [
      'an Endpoint',
      service({ endpoints: { 'GET /things': anEndpoint({ body: schema }) } }),
      'endpoints.GET /things (getThing)',
    ],
    ['a def', service({ defs: { tree: schema } }), 'defs.tree'],
    [
      'an export',
      {
        format: 1,
        kind: 'definitions',
        name: '@org/definitions',
        standardRejections,
        defs: {},
        exports: { money: { kind: 'schema', schema } },
        guards: {},
        codes: {},
      },
      'exports.money',
    ],
  ];

  test.for(cases(nested(253)))('%s is named by its entry in the Snapshot', ([, snapshot, site]) => {
    const failure = nestingFailureOf(snapshot);

    expect(failure === undefined ? undefined : failureLineOf(failure)).toBe(
      `${site} not allowed: ${message}`,
    );
  });

  test.for(cases(nested(252)))('%s nested to 252 levels is allowed', ([, snapshot]) => {
    const failure = nestingFailureOf(snapshot);

    expect(failure).toBeUndefined();
  });

  describe('a Qualifier value, which is no schema, nests with the file', () => {
    const qualified = (levels: number): Snapshot => {
      let qualifier: unknown = 'admin';
      for (let level = 0; level < levels; level++) {
        qualifier = [qualifier];
      }
      const guards = [{ guard: 'apiKey', qualifier }];
      return service({ endpoints: { 'GET /things': { ...anEndpoint({}), guards } } });
    };

    test('a Qualifier value past 256 levels of the file is named by its Endpoint', () => {
      const failure = nestingFailureOf(qualified(252));

      expect(failure === undefined ? undefined : failureLineOf(failure)).toBe(
        'endpoints.GET /things (getThing) not allowed: JSON nested deeper than the 256 levels a Snapshot holds',
      );
    });

    test('a Qualifier value to 256 levels of the file is allowed', () => {
      const failure = nestingFailureOf(qualified(251));

      expect(failure).toBeUndefined();
    });
  });

  test.for([
    { what: 'an array', wide: () => Array.from({ length: 300_000 }, () => ({})) },
    {
      what: 'a map',
      wide: () => Object.fromEntries(Array.from({ length: 300_000 }, (_, i) => [`k${i}`, {}])),
    },
  ])(
    'a json example holding $what of 300,000 objects is no nesting failure, however wide it is',
    ({ wide }) => {
      const body: SchemaNode = { type: 'json', examples: [wide()] };

      const failure = nestingFailureOf(service({ defs: { wide: body } }));

      expect(failure).toBeUndefined();
    },
  );

  test('an Application holds no schema, so nothing nests too deep in it', () => {
    const application: ApplicationSnapshot = {
      format: 1,
      kind: 'application',
      name: 'web-app',
      dependencies: {},
    };

    const failure = nestingFailureOf(application);

    expect(failure).toBeUndefined();
  });
});

describe('failure lines: steps and written values', () => {
  test('a failure sits at the steps the Check names, so they spell the Snapshot path', () => {
    const getThing = oneAnEndpoint('getThing', 'GET /things', {
      success: { status: 200, body: z.object({ v: z.string().default('x') }) },
    });
    const root = serviceOf(getThing);

    const validated = validateRoot(root, aRootPackage(root));

    const steps =
      validated.kind === 'invalid' ? validated.failures.map((f) => snapshotPathOf(f.steps)) : [];
    expect(steps).toEqual([['success', 'body', 'fields', 'v']]);
  });

  test('a path that breaks the grammar is echoed quoted, so its spaces show', () => {
    const odd = oneAnEndpoint('odd', 'GET /odd', { path: 'orders/x ' });

    expect(linesOf(serviceOf(odd))).toEqual([
      'endpoints.GET /orders/x  (odd) path canonical-path: A path starts with /: "orders/x "',
      'endpoints.GET /orders/x  (odd) path canonical-path: A path segment is lower-case letters, digits and dashes: "x "',
    ]);
  });

  test('a reserved code is echoed quoted', () => {
    const reserved = defineRejection({ code: 'NO_SUCH_ENDPOINT', status: 410, message: 'Gone' });
    const odd = oneAnEndpoint('odd', 'GET /odd', { rejections: [reserved] });

    expect(linesOf(serviceOf(odd))).toEqual([
      'codes.NO_SUCH_ENDPOINT code reserved-code: A code cf-loom answers as a Fault is reserved: "NO_SUCH_ENDPOINT"',
    ]);
  });
});

describe('failure lines: a declaration with no usable name', () => {
  const groupOf = (...endpoints: readonly Endpoint[]) =>
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: endpoints as never,
    });

  test('a Rejection whose code is no string sits at the place that lists it', () => {
    const nameless = defineRejection({ code: 5 as never, status: 409, message: 'Locked' });
    const lockThing = oneAnEndpoint('lockThing', 'POST /c', { rejections: [nameless] });

    expect(linesOf(serviceOf(lockThing))).toEqual([
      'endpoints.POST /c (lockThing) rejections[0].code not-a-string: code is a string',
    ]);
  });

  test('a Rejection whose code is no string sits at the Guard that lists it before its export', () => {
    const nameless = defineRejection({ code: 5 as never, status: 409, message: 'Locked' });
    const locker = defineGuard({ name: 'locker', description: 'Locks', rejections: [nameless] });
    const root = defineDefinitions({});
    const rootExports = { nameless, locker };

    expect(linesOf(root, { rootExports })).toEqual([
      'guards.locker rejections[0].code not-a-string: code is a string',
    ]);
  });

  test('a Guard whose name is no string sits at the place that attaches it', () => {
    const nameless = defineGuard({ name: 5 as never, description: 'A guard' });
    const guarded = oneAnEndpoint('guarded', 'GET /a', { guards: [nameless] });

    expect(linesOf(serviceOf(guarded))).toEqual([
      'endpoints.GET /a (guarded) guards[0].name not-a-string: name is a string',
    ]);
  });

  test('a Guard whose name is no string sits at the exported Guard that lists it, not at its own export', () => {
    const nameless = defineGuard({ name: 5 as never, description: 'A guard' });
    const outer = defineGuard({ name: 'outer', description: 'Outer', guards: [nameless] });
    const root = defineDefinitions({});
    const rootExports = { aa: nameless, outer };

    expect(linesOf(root, { rootExports })).toEqual([
      'guards.outer guards[0].name not-a-string: name is a string',
    ]);
  });

  test('a Guard whose name is no string that no list holds sits at its export', () => {
    const nameless = defineGuard({ name: 5 as never, description: 'A guard' });
    const root = defineDefinitions({});
    const rootExports = { aa: nameless };

    expect(linesOf(root, { rootExports })).toEqual([
      'exports.aa name not-a-string: name is a string',
    ]);
  });

  test('a Guard whose name is no string sits at the Guard an earlier Endpoint attaches, not at a later Endpoint', () => {
    const nameless = defineGuard({ name: 5 as never, description: 'A guard' });
    const gone = defineGuard({ name: 'gone', description: 'Gone', guards: [nameless] });
    const first = oneAnEndpoint('aaa', 'GET /a', { guards: [gone] });
    const second = oneAnEndpoint('bbb', 'GET /b', { guards: [nameless] });

    expect(linesOf(serviceOf(first, second))).toEqual([
      'guards.gone guards[0].name not-a-string: name is a string',
      'endpoints.GET /a (aaa) guards[0] guard-order: gone requires 5 earlier in guards',
    ]);
  });

  test.for([
    ['before', 'a', 'b'],
    ['after', 'b', 'a'],
  ] as const)(
    'a Guard whose name is no string sits at the exported Guard that lists it, its export %s that Guard',
    ([, listedExport, listingExport]) => {
      const listed = defineGuard({ name: 5 as never, description: 'Listed' });
      const listing = defineGuard({ name: 6 as never, description: 'Listing', guards: [listed] });
      const root = defineDefinitions({});
      const rootExports = { [listedExport]: listed, [listingExport]: listing };

      expect(linesOf(root, { rootExports })).toEqual([
        `exports.${listingExport} guards[0].name not-a-string: name is a string`,
        `exports.${listingExport} name not-a-string: name is a string`,
      ]);
    },
  );

  test('a Guard whose name is no string that two lists reach sits at the one met first, the deeper one', () => {
    const nameless = defineGuard({ name: 5 as never, description: 'A guard' });
    const middle = defineGuard({ name: 'middle', description: 'Middle', guards: [nameless] });
    const outer = defineGuard({ name: 'outer', description: 'Outer', guards: [middle, nameless] });
    const root = defineDefinitions({});
    const rootExports = { a: outer, b: middle, c: nameless };

    expect(linesOf(root, { rootExports })).toEqual([
      'guards.middle guards[0].name not-a-string: name is a string',
    ]);
  });

  test.for([1, 2, 3])(
    'the Guards an exported Guard reaches unexported, seed %i, are each named once, after the Guards it lists',
    (seed) => {
      const next = seededNext(seed);
      const guards: Guard[] = [];
      for (let index = 0; index < 30; index++) {
        const listed = guards.filter(() => next() < 0.2);
        guards.push(defineGuard({ name: `g${index}`, description: 'A node', guards: listed }));
      }
      const top = defineGuard({ name: 'top', description: 'Top', guards: [...guards].reverse() });

      const lines = linesOf(defineDefinitions({}), { rootExports: { top } });

      const named = lines.map((line) => line.split(': ').at(-1));
      expect(named).toEqual(listedFirstOf(top).filter((name) => name !== 'top'));
    },
  );

  test('a Rejection whose code is no string sits at the Endpoint that lists it, before its Guard', () => {
    const nameless = defineRejection({ code: 5 as never, status: 409, message: 'Locked' });
    const locker = defineGuard({ name: 'locker', description: 'Locks', rejections: [nameless] });
    const lockThing = oneAnEndpoint('lockThing', 'POST /c', {
      guards: [locker],
      rejections: [nameless],
    });

    expect(linesOf(serviceOf(lockThing))).toEqual([
      'endpoints.POST /c (lockThing) rejections[0].code not-a-string: code is a string',
    ]);
  });

  test('a Rejection whose code is no string sits at the first exported Guard in member order that lists it, whichever Guard lists another', () => {
    const nameless = defineRejection({ code: 5 as never, status: 409, message: 'Locked' });
    const leaf = defineGuard({ name: 'a', description: 'A', rejections: [nameless] });
    const middle = defineGuard({ name: 'c', description: 'C', guards: [leaf] });
    const top = defineGuard({
      name: 'b',
      description: 'B',
      guards: [middle],
      rejections: [nameless],
    });
    const root = defineDefinitions({});
    const rootExports = { a: leaf, b: top, c: middle, nameless };

    expect(linesOf(root, { rootExports })).toEqual([
      'guards.a rejections[0].code not-a-string: code is a string',
    ]);
  });

  test('a Rejection whose code is no string sits at a Guard before the Guard it lists', () => {
    const nameless = defineRejection({ code: 5 as never, status: 409, message: 'Locked' });
    const inner = defineGuard({ name: 'inner', description: 'Inner', rejections: [nameless] });
    const outer = defineGuard({
      name: 'outer',
      description: 'Outer',
      guards: [inner],
      rejections: [nameless],
    });
    const root = defineDefinitions({});
    const rootExports = { a: outer, b: inner, c: nameless };

    expect(linesOf(root, { rootExports })).toEqual([
      'guards.outer rejections[0].code not-a-string: code is a string',
    ]);
  });

  test('an Event with no name and no version sits at the Group that lists it', () => {
    const nameless = defineEvent({
      visibility: 'internal',
      description: 'An event',
      body: z.object({ id: z.string() }),
    } as never);
    const group = defineGroup({ name: 'orders', description: 'Orders', events: [nameless] });

    expect(linesOf(defineService({ name: 'orders-service', groups: [group] }))).toEqual([
      'groups.orders events[0].name required-field: name is a required string',
      'groups.orders events[0].version required-field: version is a required field',
    ]);
  });

  test('an Endpoint whose path is no string sits at the Group that lists it', () => {
    const odd = oneAnEndpoint('odd', 'GET /odd', { path: 5 });

    expect(linesOf(defineService({ name: 'orders-service', groups: [groupOf(odd)] }))).toEqual([
      'groups.orders endpoints[0].path not-a-string: path is a string',
    ]);
  });

  test('an Endpoint with no method sits at the Group that lists it', () => {
    const odd = oneAnEndpoint('odd', 'GET /odd', { method: undefined });

    expect(linesOf(defineService({ name: 'orders-service', groups: [groupOf(odd)] }))).toEqual([
      'groups.orders endpoints[0].method required-field: method is a required string',
    ]);
  });
});

describe('failure lines: a schema several places reach', () => {
  const shared = z.object({ v: z.string().default('x') });
  const reaching = (name: string, route: string) =>
    oneAnEndpoint(name, route, { success: { status: 200, body: shared } });

  test('a construct in a schema three Endpoints share is one line naming the other two', () => {
    const lines = linesOf(
      serviceOf(reaching('c', 'POST /c'), reaching('b', 'POST /b'), reaching('a', 'GET /a')),
    );

    expect(lines).toEqual([
      'endpoints.GET /a (a) success.body.v not allowed: .default() (also in endpoints.POST /b (b), endpoints.POST /c (c))',
    ]);
  });

  test('the order the Endpoints are declared in changes no line', () => {
    const endpoints = [reaching('a', 'GET /a'), reaching('b', 'POST /b'), reaching('c', 'GET /c')];

    const forward = linesOf(serviceOf(...endpoints));
    const backward = linesOf(serviceOf(...[...endpoints].reverse()));

    expect(backward).toEqual(forward);
  });

  test('a construct in a Definitions Package’s schema says its origin, package, version and name', () => {
    const money = z.object({ amount: z.number().default(0) });
    const definitions = defineDefinitions({});
    const installed = anInstalledPackage(definitions, { money });
    const pay = oneAnEndpoint('pay', 'POST /pay', { success: { status: 200, body: money } });

    const lines = linesOf(serviceOf(pay), { packages: [installed] });

    expect(lines).toEqual([
      'endpoints.POST /pay (pay) success.body.amount not allowed: .default() (declared in @org/definitions@4.2.0#money)',
    ]);
  });
});

describe('failure lines: a refusal inside a schema reached at two places', () => {
  const seedCount = 400;
  const dateLine = 'not allowed: z.date() (use z.iso.datetime())';

  /** A def on a cycle holding a random nested schema under `c`, with a `z.date()` at each leaf. */
  function aDefAroundDates(next: () => number) {
    const dated = randomNested({ next, leaf: () => z.date(), keysHoldLeaves: true }, 3);
    const def: z.ZodType = z
      .object({
        c: dated.schema,
        get self() {
          return def.optional();
        },
      })
      .meta({ id: 'shared' });
    return { def, dated };
  }

  /** A random nested schema that holds `def` once, wherever the draw puts it. */
  function holding(next: () => number, def: z.ZodType): RandomSchema {
    let isPlaced = false;
    const leaf = () => {
      const held = isPlaced ? undefined : def;
      isPlaced = true;
      return held;
    };
    return randomNested({ next, leaf, keysHoldLeaves: false }, 3);
  }

  /** The Endpoint's body holds the def at two places, and the lines the dates inside it are told by. */
  function reachedTwiceBy(seed: number) {
    const next = seededNext(seed);
    const { def, dated } = aDefAroundDates(next);
    const wrapped = [holding(next, def), holding(next, def)];
    const [firstName, secondName] = next() < 0.5 ? ['a', 'b'] : ['b', 'a'];
    const body = z.object({
      [firstName as string]: wrapped[0]?.schema as z.ZodType,
      [secondName as string]: wrapped[1]?.schema as z.ZodType,
    });
    const places = [
      `input.body${tailTextOf(inField(firstName as string, wrapped[0]?.leaves[0]?.steps ?? []))}`,
      `input.body${tailTextOf(inField(secondName as string, wrapped[1]?.leaves[0]?.steps ?? []))}`,
    ];
    const [first] = [...places].sort();
    const site = 'endpoints.POST /things (getThing)';
    const lines = dated.leaves.map(
      ({ steps }) => `${site} ${first}${tailTextOf(inField('c', steps))} ${dateLine}`,
    );
    const crossed = [...wrapped, dated].flatMap(({ leaves }) =>
      leaves.flatMap((leaf) => leaf.crossing),
    );
    return { body, lines, crossed };
  }

  test('it is told at the first place, followed by the steps inside the schema, in random nested schemas', () => {
    const wrong: string[] = [];
    const crossed = new Set<Construct>();

    for (let seed = 1; seed <= seedCount; seed++) {
      const { body, lines, crossed: crossing } = reachedTwiceBy(seed);
      const getThing = oneAnEndpoint('getThing', 'POST /things', { input: { body } });
      const told = linesOf(serviceOf(getThing));
      if (JSON.stringify([...told].sort()) !== JSON.stringify([...lines].sort())) {
        wrong.push(`seed ${seed}: ${JSON.stringify(told)} not ${JSON.stringify(lines)}`);
      }
      for (const construct of crossing) {
        crossed.add(construct);
      }
    }

    expect(wrong).toEqual([]);
    expect([...crossed].sort()).toEqual([...constructs].sort());
  });
});

describe('failure lines: what a Group lists', () => {
  test('a Group listing a Provider’s Element fails at the Group, naming the Element and its Provider', () => {
    const billing = defineGroup({
      name: 'billing',
      description: 'Billing',
      events: [pingedV1],
    } as never);
    const root = defineService({ name: 'billing-service', groups: [billing] });

    expect(linesOf(root)).toEqual([
      "groups.billing provided-element: A Group lists the Contract's own Elements: Pinged@1 is ping-service's",
    ]);
  });

  test('an Endpoint listed by two Groups fails at the second Group, naming the first', () => {
    const listOrders = oneAnEndpoint('listOrders', 'GET /orders');
    const first = defineGroup({ name: 'orders', description: 'Orders', endpoints: [listOrders] });
    const second = defineGroup({
      name: 'billing',
      description: 'Billing',
      endpoints: [listOrders],
    });
    const root = defineService({ name: 'orders-service', groups: [first, second] });

    expect(linesOf(root)).toEqual([
      'groups.billing group-membership: An Endpoint belongs to exactly one Group: listOrders is also in orders',
    ]);
  });
});

describe('failure lines: Standard Rejections and the Snapshot', () => {
  test('a Standard Rejection mapped to a code that breaks a rule is named standardRejections.notFound', () => {
    const definitions = defineDefinitions({
      standardRejections: { notFound: { code: 'not-found', status: 404, message: 'Gone' } },
    });

    expect(linesOf(definitions)).toEqual([
      'standardRejections.notFound code name-grammar: A Rejection code is UPPER_SNAKE_CASE: "not-found"',
    ]);
  });
});

/** The names of a Guard and every Guard it reaches, each once, every Guard after those it lists. */
function listedFirstOf(guard: Guard, named: string[] = []): string[] {
  for (const listed of guard.guards ?? []) {
    listedFirstOf(listed, named);
  }
  if (!named.includes(String(guard.name))) {
    named.push(String(guard.name));
  }
  return named;
}
