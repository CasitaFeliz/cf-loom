import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Command, defineCommand, defineContract, defineEvent, type Event } from '../index.ts';
import { validateContract } from '../internal/index.ts';

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
  const contract = defineContract({
    name: 'orders-service',
    events: events as readonly Event[],
    commands: commands as readonly Command[],
  });
  return validateContract(contract, {
    originOf: () => undefined,
    packageName: 'orders-service',
    exportsOf: () => [],
  });
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: Events and Commands', () => {
  test('a Contract with Events and Commands validates', () => {
    const result = validateMessages([anEvent()], [aCommand()]);

    expect(result.kind).toBe('valid');
  });

  test('a Message name that is not PascalCase fails', () => {
    const result = validateMessages([anEvent({ name: 'orderCreated' })]);

    expect(result).toEqual(
      failed(
        ['events', 'orderCreated@1', 'name'],
        'name-grammar',
        'A Message name is PascalCase: orderCreated',
      ),
    );
  });

  test('a version that is not a whole number from 1 fails, as a cast lets it through', () => {
    const result = validateMessages([], [aCommand({ version: 0 })]);

    expect(result).toEqual(
      failed(
        ['commands', 'ChargeCard@0', 'version'],
        'message-version',
        'A Message version is a whole number from 1: 0',
      ),
    );
  });

  test('a Public Event fails, as a cast lets it through', () => {
    const result = validateMessages([anEvent({ visibility: 'public' })]);

    expect(result).toEqual(
      failed(
        ['events', 'OrderCreated@1', 'visibility'],
        'visibility',
        "An Event's Visibility is internal or private: public",
      ),
    );
  });

  test('a Command declaring a Visibility fails', () => {
    const result = validateMessages([], [aCommand({ visibility: 'private' })]);

    expect(result).toEqual(
      failed(
        ['commands', 'ChargeCard@1', 'visibility'],
        'undeclared-field',
        'visibility is not a declared field',
      ),
    );
  });

  test('a Message lifecycle that is none of the three fails', () => {
    const result = validateMessages([anEvent({ lifecycle: 'gone' })]);

    expect(result).toEqual(
      failed(
        ['events', 'OrderCreated@1', 'lifecycle'],
        'lifecycle',
        'A lifecycle is active, deprecated or retired: gone',
      ),
    );
  });

  test('an Event without a body fails as a required field', () => {
    const result = validateMessages([anEvent({ body: undefined })]);

    expect(result).toEqual(
      failed(['events', 'OrderCreated@1', 'body'], 'required-field', 'body is a required field'),
    );
  });

  test('an Event body that is not a zod schema fails', () => {
    const result = validateMessages([anEvent({ body: { orderId: 'uuid' } })]);

    expect(result).toEqual(
      failed(['events', 'OrderCreated@1', 'body'], 'not-a-schema', 'body is not a zod schema'),
    );
  });

  test('an Event body holding a record keyed by an enum fails, as in any Read shape', () => {
    const totals = z.record(z.enum(['eur', 'usd']), z.int());
    const result = validateMessages([anEvent({ body: z.object({ totals }) })]);

    expect(result).toMatchObject({
      kind: 'invalid',
      failures: [
        {
          kind: 'not-allowed',
          at: ['events', 'OrderCreated@1', 'body', 'fields', 'totals'],
          construct: 'a record keyed by an enum or literal in a Read shape',
        },
      ],
    });
  });

  test('something listed under events that is not an Event fails', () => {
    const result = validateMessages([{ kind: 'event', name: 'OrderCreated', version: 1 }]);

    expect(result).toEqual(failed(['events', 0], 'not-a-declaration', 'events.0 is not an Event'));
  });

  test('two Message Versions with one name and version fail', () => {
    const result = validateMessages([anEvent(), anEvent({ visibility: 'private' })]);

    expect(result).toEqual(
      failed(
        ['events', 'OrderCreated@1', 'version'],
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
        ['commands', 'ChargeCard@1', 'name'],
        'message-kind',
        'A Message name belongs to one kind: ChargeCard is an Event and a Command',
      ),
    );
  });

  test('two Active versions of a Command fail', () => {
    const result = validateMessages([], [aCommand(), aCommand({ version: 2 })]);

    expect(result).toEqual(
      failed(
        ['commands', 'ChargeCard@2', 'lifecycle'],
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
        ['events', 'OrderCreated@1', 'description'],
        'required-field',
        'description is a required string',
      ),
    );
  });

  test('a version that is not a whole number fails, as a cast lets it through', () => {
    const result = validateMessages([anEvent({ version: 1.5 })]);

    expect(result).toEqual(
      failed(
        ['events', 'OrderCreated@1.5', 'version'],
        'message-version',
        'A Message version is a whole number from 1: 1.5',
      ),
    );
  });

  test('something listed under commands that is not a Command fails', () => {
    const result = validateMessages([], [anEvent({ name: 'ChargeCard' })]);

    expect(result).toEqual(
      failed(['commands', 0], 'not-a-declaration', 'commands.0 is not a Command'),
    );
  });

  test('a Command name that is not PascalCase fails', () => {
    const result = validateMessages([], [aCommand({ name: 'charge_card' })]);

    expect(result).toEqual(
      failed(
        ['commands', 'charge_card@1', 'name'],
        'name-grammar',
        'A Message name is PascalCase: charge_card',
      ),
    );
  });

  test('a Command without a description fails as a required field', () => {
    const result = validateMessages([], [aCommand({ description: undefined })]);

    expect(result).toEqual(
      failed(
        ['commands', 'ChargeCard@1', 'description'],
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
        ['commands', 'ChargeCard@1', 'version'],
        'duplicate-message-identity',
        'A Message Version is identified by its name and version, once: ChargeCard@1',
      ),
    );
  });

  test('two Active Command versions with one identity fail once, as a duplicate identity', () => {
    const result = validateMessages([], [aCommand(), aCommand()]);

    expect(result).toEqual(
      failed(
        ['commands', 'ChargeCard@1', 'version'],
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
        ['commands', 'ChargeCard@1', 'name'],
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
          at: ['commands', 'ChargeCard@1', 'version'],
          rule: 'duplicate-message-identity',
          message: 'A Message Version is identified by its name and version, once: ChargeCard@1',
        },
        {
          kind: 'declaration',
          at: ['commands', 'ChargeCard@2', 'lifecycle'],
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

describe('validateContract: Message Versions that fail only as fields', () => {
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
