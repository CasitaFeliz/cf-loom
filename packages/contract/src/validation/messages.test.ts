import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import {
  type Command,
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  type Event,
} from '../index.ts';
import { messageIdentityOf, nameAndVersionOf, validateRoot } from '../internal/index.ts';

const body = z.object({ orderId: z.uuid() });

/** An Event's declaration with sensible defaults, as an author writes it. */
function anEvent(overrides: Record<string, unknown> = {}): Event {
  const written = {
    name: 'OrderCreated',
    version: 1,
    visibility: 'internal',
    description: 'An order was placed',
    body,
    ...overrides,
  } as const;
  return defineEvent(written as unknown as Parameters<typeof defineEvent>[0]);
}

/** A Command's declaration with sensible defaults, as an author writes it. */
function aCommand(overrides: Record<string, unknown> = {}): Command {
  const written = {
    name: 'ChargeCard',
    version: 1,
    description: 'Charges the order’s card',
    body,
    ...overrides,
  } as const;
  return defineCommand(written as unknown as Parameters<typeof defineCommand>[0]);
}

function validateMessages(events: readonly unknown[], commands: readonly unknown[] = []) {
  const ordersGroup = defineGroup({
    name: 'orders',
    description: 'Orders',
    events,
    commands,
  } as unknown as Parameters<typeof defineGroup>[0]);
  const contract = defineService({ name: 'orders-service', groups: [ordersGroup] });
  return validateRoot(contract, aRootPackage(contract, { packageName: 'orders-service' }));
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateRoot: Events and Commands', () => {
  test('a Contract with Events and Commands validates', () => {
    const result = validateMessages([anEvent()], [aCommand()]);

    expect(result.kind).toBe('valid');
  });

  test('a Message name that is not PascalCase fails', () => {
    const result = validateMessages([anEvent({ name: 'orderCreated' })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'orderCreated@1', 'name'],
        'name-grammar',
        'A Message name is PascalCase words: "orderCreated"',
      ),
    );
  });

  test.each([
    ['URLRefresh', 'A Message name is PascalCase words: "URLRefresh" (write UrlRefresh)'],
    ['OrderID', 'A Message name is PascalCase words: "OrderID" (write OrderId)'],
    ['PlanA', 'A Message name is PascalCase words: "PlanA"'],
    ['A', 'A Message name is PascalCase words: "A"'],
  ])('a Message name %s, with a capital that starts no word, fails', (name, message) => {
    const result = validateMessages([anEvent({ name })]);

    expect(result).toEqual(
      failed(['groups', 'orders', 'events', `${name}@1`, 'name'], 'name-grammar', message),
    );
  });

  test.each(['UrlRefresh', 'OrderV2', 'Order2Items', 'Plan2'])(
    'a Message name %s, whose every capital starts a word, validates',
    (name) => {
      const result = validateMessages([anEvent({ name })]);

      expect(result.kind).toBe('valid');
    },
  );

  test('a version that is not a whole number from 1 fails, as a cast lets it through', () => {
    const result = validateMessages([], [aCommand({ version: 0 })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@0', 'version'],
        'message-version',
        'A Message version is one whole number from 1 to Number.MAX_SAFE_INTEGER: 0',
      ),
    );
  });

  test('a Public Event fails, as a cast lets it through', () => {
    const result = validateMessages([anEvent({ visibility: 'public' })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@1', 'visibility'],
        'visibility',
        `An Event's Visibility is internal or private: "public"`,
      ),
    );
  });

  test('a Command declaring a Visibility fails', () => {
    const result = validateMessages([], [aCommand({ visibility: 'private' })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@1', 'visibility'],
        'undeclared-field',
        'visibility is not a declared field',
      ),
    );
  });

  test('a Message lifecycle that is none of the three fails', () => {
    const result = validateMessages([anEvent({ lifecycle: 'gone' })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@1', 'lifecycle'],
        'lifecycle',
        'A lifecycle is active, deprecated or retired: "gone"',
      ),
    );
  });

  test('an Event without a body fails as a required field', () => {
    const result = validateMessages([anEvent({ body: undefined })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@1', 'body'],
        'required-field',
        'body is a required field',
      ),
    );
  });

  test('an Event body that is not a zod schema fails', () => {
    const result = validateMessages([anEvent({ body: { orderId: 'uuid' } })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@1', 'body'],
        'not-a-schema',
        'body is not a zod schema',
      ),
    );
  });

  test('something listed under events that is not an Event fails', () => {
    const result = validateMessages([{ kind: 'event', name: 'OrderCreated', version: 1 }]);

    expect(result).toEqual(
      failed(['groups', 'orders', 'events', 0], 'not-a-declaration', 'events.0 is not an Event'),
    );
  });

  test('two Message Versions with one name and version fail', () => {
    const result = validateMessages([anEvent(), anEvent({ visibility: 'private' })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@1', 'version'],
        'duplicate-message-identity',
        'A Message Version is identified by its name and version, once: OrderCreated@1',
      ),
    );
  });

  test('an Event and a Command with one name fail', () => {
    const result = validateMessages(
      [anEvent({ name: 'ChargeCard', version: 2 })],
      [aCommand({ version: 1 })],
    );

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@1', 'name'],
        'message-kind',
        'A Message name belongs to one kind: ChargeCard is an Event and a Command',
      ),
    );
  });

  test('two Active versions of a Command fail', () => {
    const result = validateMessages([], [aCommand(), aCommand({ version: 2 })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@2', 'lifecycle'],
        'command-active-versions',
        'A Command has at most one Active version: ChargeCard',
      ),
    );
  });

  test('an Active and a Deprecated version of a Command validate', () => {
    const result = validateMessages(
      [],
      [aCommand({ lifecycle: 'deprecated' }), aCommand({ version: 2 })],
    );

    expect(result.kind).toBe('valid');
  });

  test('two Active versions of an Event validate', () => {
    const result = validateMessages([anEvent(), anEvent({ version: 2 })]);

    expect(result.kind).toBe('valid');
  });

  test('declared versions with a gap validate, since a deleted Retired version leaves one', () => {
    const result = validateMessages([anEvent({ version: 2 }), anEvent({ version: 4 })]);

    expect(result.kind).toBe('valid');
  });

  test('an Event without a description fails', () => {
    const result = validateMessages([anEvent({ description: undefined })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@1', 'description'],
        'required-field',
        'description is a required string',
      ),
    );
  });

  test('a version that is not a whole number fails, as a cast lets it through', () => {
    const result = validateMessages([anEvent({ version: 1.5 })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@1.5', 'version'],
        'message-version',
        'A Message version is one whole number from 1 to Number.MAX_SAFE_INTEGER: 1.5',
      ),
    );
  });

  test('something listed under commands that is not a Command fails', () => {
    const result = validateMessages([], [anEvent({ name: 'ChargeCard' })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 0],
        'not-a-declaration',
        'commands.0 is not a Command',
      ),
    );
  });

  test('a Command name that is not PascalCase fails', () => {
    const result = validateMessages([], [aCommand({ name: 'charge_card' })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'charge_card@1', 'name'],
        'name-grammar',
        'A Message name is PascalCase words: "charge_card"',
      ),
    );
  });

  test('a Command without a description fails as a required field', () => {
    const result = validateMessages([], [aCommand({ description: undefined })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@1', 'description'],
        'required-field',
        'description is a required string',
      ),
    );
  });

  test('two Deprecated Command versions with one identity fail', () => {
    const deprecated = { lifecycle: 'deprecated' };

    const result = validateMessages([], [aCommand(deprecated), aCommand(deprecated)]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@1', 'version'],
        'duplicate-message-identity',
        'A Message Version is identified by its name and version, once: ChargeCard@1',
      ),
    );
  });

  test('two Active Command versions with one identity fail once, as a duplicate identity', () => {
    const result = validateMessages([], [aCommand(), aCommand()]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@1', 'version'],
        'duplicate-message-identity',
        'A Message Version is identified by its name and version, once: ChargeCard@1',
      ),
    );
  });

  test('an Event and two Command versions with one name fail once, on the first Command', () => {
    const result = validateMessages(
      [anEvent({ name: 'ChargeCard' })],
      [aCommand({ lifecycle: 'deprecated' }), aCommand({ version: 2 })],
    );

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'commands', 'ChargeCard@1', 'name'],
        'message-kind',
        'A Message name belongs to one kind: ChargeCard is an Event and a Command',
      ),
    );
  });

  test('an Event and a Command without a name or version fail only as fields, never as one kind', () => {
    const result = validateMessages([defineEvent({} as never)], [defineCommand({} as never)]);

    const rules =
      result.kind === 'invalid'
        ? result.failures.map((broken) => broken.kind === 'declaration' && broken.rule)
        : [];
    expect(rules).toContain('required-field');
    expect(rules).not.toContain('message-kind');
    expect(rules).not.toContain('duplicate-message-identity');
  });

  test('two Active Command versions and a repeat of the first fail as a duplicate and as a second Active version', () => {
    const result = validateMessages([], [aCommand(), aCommand(), aCommand({ version: 2 })]);

    expect(result).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['groups', 'orders', 'commands', 'ChargeCard@1', 'version'],
          rule: 'duplicate-message-identity',
          message: 'A Message Version is identified by its name and version, once: ChargeCard@1',
        },
        {
          kind: 'declaration',
          at: ['groups', 'orders', 'commands', 'ChargeCard@2', 'lifecycle'],
          rule: 'command-active-versions',
          message: 'A Command has at most one Active version: ChargeCard',
        },
      ],
    });
  });
});

/** The rules a result fails, in order; none when it is valid. */
function rulesOf(result: ReturnType<typeof validateMessages>): readonly unknown[] {
  if (result.kind === 'valid') {
    return [];
  }
  return result.failures.map((broken) =>
    broken.kind === 'declaration' ? broken.rule : broken.kind,
  );
}

/** A seeded generator of the same sequence every run, so a failing version can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Versions from 1 below `2 ** 53`: the boundaries, then pseudo-random ones. */
function safeVersions(): readonly number[] {
  const next = seededNext(190);
  const random = Array.from({ length: 1000 }, () => {
    const high = Math.floor(next() * 2 ** 21);
    const low = Math.floor(next() * 2 ** 32);
    return Math.max(1, high * 2 ** 32 + low);
  });
  return [1, 2, 2 ** 53 - 1, ...random];
}

describe('validateRoot: a Message Version’s version keeps its text and its predecessor exact', () => {
  test('every whole number from 1 to the largest safe integer validates, reads back from its identity and differs from its predecessor', () => {
    const versions = safeVersions();

    const results = versions.map((version) => ({
      version,
      validated: validateMessages([anEvent({ version })], [aCommand({ version })]).kind,
      readBack: nameAndVersionOf(messageIdentityOf('OrderCreated', version)).version,
      isAfterPredecessor: version - 1 !== version,
    }));

    expect(results).toEqual(
      versions.map((version) => ({
        version,
        validated: 'valid',
        readBack: version,
        isAfterPredecessor: true,
      })),
    );
  });

  test('a version past Number.MAX_SAFE_INTEGER fails saying the bound', () => {
    const validated = validateMessages([anEvent({ version: 2 ** 53 })]);

    expect(validated).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@9007199254740992', 'version'],
        'message-version',
        'A Message version is one whole number from 1 to Number.MAX_SAFE_INTEGER: 9007199254740992',
      ),
    );
  });

  test.each([2 ** 53, 1e16, 1e21, 0, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'the version %s fails, for an Event and for a Command',
    (version) => {
      const validated = validateMessages([anEvent({ version })], [aCommand({ version })]);

      expect(validated).toMatchObject({
        kind: 'invalid',
        failures: [
          { rule: 'message-version', at: expect.arrayContaining(['events']) },
          { rule: 'message-version', at: expect.arrayContaining(['commands']) },
        ],
      });
    },
  );
});

const recursiveArray: z.ZodType = z.array(z.lazy(() => recursiveArray)).meta({ id: 'rs' });

const tree = z
  .object({
    value: z.string(),
    get children() {
      return z.array(tree);
    },
  })
  .meta({ id: 'tree' });

const lazyNode: z.ZodType = z
  .object({ value: z.string(), next: z.lazy(() => lazyNode).optional() })
  .meta({ id: 'lazyNode' });

const notObjects = {
  'a string': z.string(),
  'a literal': z.literal('created'),
  'an array of objects': z.array(z.object({ orderId: z.uuid() })),
  'a record': z.record(z.string(), z.string()),
  'a discriminated union': z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('a') }),
    z.object({ kind: z.literal('b') }),
  ]),
  'a nullable object': z.object({ orderId: z.uuid() }).nullable(),
  'a recursive array': recursiveArray,
};

const objects = {
  'an object': z.object({ orderId: z.uuid() }),
  'an intersection of objects': z.intersection(
    z.object({ orderId: z.uuid() }),
    z.object({ total: z.int() }),
  ),
  'a z.lazy() object': z.lazy(() => z.object({ orderId: z.uuid() })),
  'a recursive object written with a getter': tree,
  'a recursive object written with z.lazy()': lazyNode,
};

describe('validateRoot: a Message body is an object of its fields', () => {
  const eventAt = ['groups', 'orders', 'events', 'OrderCreated@1', 'body'];
  const commandAt = ['groups', 'orders', 'commands', 'ChargeCard@1', 'body'];

  test.each(Object.entries(notObjects))('an Event whose body is %s fails', (_, body) => {
    const result = validateMessages([anEvent({ body })]);

    expect(result).toEqual(
      failed(
        eventAt,
        'not-an-object-schema',
        'A Message body is an object of its fields: OrderCreated@1',
      ),
    );
  });

  test.each(Object.entries(notObjects))('a Command whose body is %s fails', (_, body) => {
    const result = validateMessages([], [aCommand({ body })]);

    expect(result).toEqual(
      failed(
        commandAt,
        'not-an-object-schema',
        'A Message body is an object of its fields: ChargeCard@1',
      ),
    );
  });

  test.each(Object.entries(objects))('an Event whose body is %s validates', (_, body) => {
    const result = validateMessages([anEvent({ body })]);

    expect(result.kind).toBe('valid');
  });

  test.each(Object.entries(objects))('a Command whose body is %s validates', (_, body) => {
    const result = validateMessages([], [aCommand({ body })]);

    expect(result.kind).toBe('valid');
  });
});

describe('validateRoot: Message Versions that fail only as fields', () => {
  test.each([
    ['two Events with no name', [anEvent({ name: undefined }), anEvent({ name: undefined })], []],
    [
      'two Commands with no version',
      [],
      [aCommand({ version: undefined }), aCommand({ version: undefined })],
    ],
    [
      'two Commands with a version written as text',
      [],
      [aCommand({ version: '1' }), aCommand({ version: '1' })],
    ],
    [
      'two Commands with no name',
      [],
      [aCommand({ name: undefined }), aCommand({ name: undefined, version: 2 })],
    ],
    [
      'two Commands with a null lifecycle',
      [],
      [aCommand({ lifecycle: null }), aCommand({ lifecycle: null, version: 2 })],
    ],
  ])('%s fail only as fields', (_case, events, commands) => {
    const result = validateMessages(events, commands);

    const rules = rulesOf(result);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules).not.toContain('duplicate-message-identity');
    expect(rules).not.toContain('command-active-versions');
  });
});
