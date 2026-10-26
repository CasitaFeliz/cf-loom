import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { pingedV1 } from '../../test/ping-package.ts';
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
} from '../index.ts';
import {
  failureLineOf,
  nestingFailureOf,
  type Root,
  type RootPackage,
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
  const orderLocked = 'ORDER_LOCKED';
  const deep = (): unknown => {
    let nested: unknown = {};
    for (let depth = 0; depth < 300; depth++) {
      nested = { inner: nested };
    }
    return nested;
  };

  test.for([
    ['an Event', { events: { 'OrderCreated@1': { body: deep() } } }, 'events.OrderCreated@1'],
    ['a Command', { commands: { 'ChargeCard@1': { body: deep() } } }, 'commands.ChargeCard@1'],
    ['a code', { codes: { [orderLocked]: { body: deep() } } }, 'codes.ORDER_LOCKED'],
    ['a Guard', { guards: { apiKey: { context: deep() } } }, 'guards.apiKey'],
    ['an export', { exports: { money: { schema: deep() } } }, 'exports.money'],
    ['a def', { defs: { tree: deep() } }, 'defs.tree'],
    ['no Element', { heading: deep() }, '(root)'],
  ] as const)('%s is named by its entry in the Snapshot', ([, snapshot, site]) => {
    const failure = nestingFailureOf(snapshot);

    expect(failure === undefined ? undefined : failureLineOf(failure)).toBe(
      `${site} not allowed: JSON nested deeper than the 256 levels a Snapshot holds`,
    );
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

  test('a Guard whose name is no string sits at the place that attaches it', () => {
    const nameless = defineGuard({ name: 5 as never, description: 'A guard' });
    const guarded = oneAnEndpoint('guarded', 'GET /a', { guards: [nameless] });

    expect(linesOf(serviceOf(guarded))).toEqual([
      'endpoints.GET /a (guarded) guards[0].name not-a-string: name is a string',
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

  test('a Snapshot nested too deep is named by the Element it sits in', () => {
    let nested: unknown = {};
    for (let depth = 0; depth < 300; depth++) {
      nested = { inner: nested };
    }
    const snapshot = { endpoints: { 'GET /things/{}': { name: 'getThing', input: nested } } };

    const failure = nestingFailureOf(snapshot);

    expect(failure === undefined ? undefined : failureLineOf(failure)).toBe(
      'endpoints.GET /things/{} (getThing) not allowed: JSON nested deeper than the 256 levels a Snapshot holds',
    );
  });
});

describe('failure lines: shared refused schemas, drawn at random', () => {
  const refusedSchemas = [() => z.string().default('a'), () => z.date(), () => z.any()] as const;

  test.for([1, 2, 3, 4, 5, 6, 7, 8])(
    'draw %i: one line for each refused schema reached, whatever the order of declaration',
    (seed) => {
      const next = seededNext(seed);
      const schemas = refusedSchemas.flatMap((make) => twiceOrOnce(make, next));
      const count = 1 + Math.floor(next() * 5);
      const endpoints = Array.from({ length: count }, (_, index) => {
        const chosen = schemas.filter(() => next() < 0.5);
        const fields = Object.fromEntries(chosen.map((schema, at) => [`v${at}`, schema]));
        return oneAnEndpoint(`e${index}`, `GET /e${index}`, {
          success: { status: 200, body: z.object(fields) },
        });
      });
      const reached = new Set(endpoints.flatMap(reachedSchemasOf));

      const forward = linesOf(serviceOf(...endpoints));
      const backward = linesOf(serviceOf(...[...endpoints].reverse()));

      expect(forward).toHaveLength(reached.size);
      expect([...backward].sort()).toEqual([...forward].sort());
    },
  );
});

/** The refused schemas an Endpoint's Success body holds. */
function reachedSchemasOf(endpoint: Endpoint): readonly unknown[] {
  const body: unknown = endpoint.success.body;
  return body instanceof z.ZodObject ? Object.values(body.shape) : [];
}

/** One schema of a kind, or two distinct ones, as the draw says. */
function twiceOrOnce(make: () => z.ZodType, next: () => number): readonly z.ZodType[] {
  const schemas = [make()];
  if (next() >= 0.7) {
    schemas.push(make());
  }
  return schemas;
}
