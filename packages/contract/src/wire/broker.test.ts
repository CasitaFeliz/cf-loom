import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { seededNext } from '../../test/random-schemas.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
} from '../index.ts';
import {
  brokerHeaderBytesOf,
  brokerHeadersOf,
  brokerMessageIdHeader,
  brokerMessageIdOf,
  durableNameOf,
  factIdHeader,
  follows,
  isBrokerPrefix,
  isIdHeaderValue,
  isPrefixedName,
  isPrefixedSubject,
  kebabCase,
  prefixedNameOf,
  prefixedSubjectOf,
  receivedHeadersOf,
  siteTextOf,
  streamNameOf,
  subjectOf,
  transportHeaderFitOf,
  validateRoot,
} from '../internal/index.ts';

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was created',
  body: z.object({ orderId: z.string() }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.string() }),
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notifies the customer of each order created',
  event: orderCreatedV2,
});

function messageTuples(): {
  readonly message: {
    readonly kind: 'event' | 'command';
    readonly name: string;
    readonly version: number;
  };
  readonly factId: string;
}[] {
  const kinds = ['event', 'command'] as const;
  const names = ['A', 'Ab'];
  const versions = [1, 2, 12];
  const factIds = ['x', '1:x', 'v1:x', '.x'];
  const tuples = [];
  for (const kind of kinds) {
    for (const name of names) {
      for (const version of versions) {
        for (const factId of factIds) {
          tuples.push({ message: { kind, name, version }, factId });
        }
      }
    }
  }
  return tuples;
}

describe('the Wire protocol over the broker', () => {
  test('a subject is <service>.<event|command>.<Name>.v<n>', () => {
    const subjects = [
      subjectOf('orders-service', orderCreatedV2),
      subjectOf('orders-service', chargeCardV1),
    ];

    expect(subjects).toEqual([
      'orders-service.event.OrderCreated.v2',
      'orders-service.command.ChargeCard.v1',
    ]);
  });

  test('a stream is named after its Service', () => {
    const stream = streamNameOf('orders-service');

    expect(stream).toBe('orders-service');
  });

  test('a Subscription’s durable consumer is <service>_<name in kebab-case> and a Command Version’s <service>_command_<Name>_v<n>', () => {
    const durables = [
      durableNameOf('orders-service', notifyOnCreated),
      durableNameOf('orders-service', chargeCardV1),
    ];

    expect(durables).toEqual([
      'orders-service_notify-on-created',
      'orders-service_command_ChargeCard_v1',
    ]);
  });

  test('two Subscriptions whose names differ only in the case of a letter get two durable consumers', () => {
    const settle2xy = defineSubscription({
      name: 'settle2xy',
      description: 'Settles lower',
      event: orderCreatedV2,
    });
    const settle2Xy = defineSubscription({
      name: 'settle2Xy',
      description: 'Settles upper',
      event: orderCreatedV2,
    });

    const durables = [
      durableNameOf('orders-service', settle2xy),
      durableNameOf('orders-service', settle2Xy),
    ];

    expect(durables).toEqual(['orders-service_settle2xy', 'orders-service_settle2-xy']);
  });

  test('a prefixed subject is <prefix>.<subject> and a prefixed stream or durable consumer <prefix>_<name>', () => {
    const subject = subjectOf('orders-service', orderCreatedV2);

    const prefixed = [
      prefixedSubjectOf('staging', subject),
      prefixedNameOf('staging', streamNameOf('orders-service')),
      prefixedNameOf('staging', durableNameOf('orders-service', notifyOnCreated)),
    ];

    expect(prefixed).toEqual([
      'staging.orders-service.event.OrderCreated.v2',
      'staging_orders-service',
      'staging_orders-service_notify-on-created',
    ]);
  });

  test('with no prefix a subject, a stream and a durable consumer are themselves', () => {
    const subject = subjectOf('orders-service', orderCreatedV2);

    const names = [
      prefixedSubjectOf(null, subject),
      prefixedNameOf(null, streamNameOf('orders-service')),
      prefixedNameOf(null, durableNameOf('orders-service', notifyOnCreated)),
    ];

    expect(names).toEqual([
      'orders-service.event.OrderCreated.v2',
      'orders-service',
      'orders-service_notify-on-created',
    ]);
  });

  test('a stream, a durable consumer and a subject carry the prefix they were prefixed with', () => {
    const subject = subjectOf('orders-service', orderCreatedV2);

    const carried = [
      isPrefixedName('staging', prefixedNameOf('staging', streamNameOf('orders-service'))),
      isPrefixedName(
        'staging',
        prefixedNameOf('staging', durableNameOf('orders-service', notifyOnCreated)),
      ),
      isPrefixedSubject('staging', prefixedSubjectOf('staging', subject)),
    ];

    expect(carried).toEqual([true, true, true]);
  });

  test('a name or subject without the prefix, or with it only in the middle or without its separator, does not carry it', () => {
    const names = [
      'orders-service',
      'a_staging_orders-service',
      'staging-orders-service',
      'stagingorders',
    ];
    const subjects = [
      'orders-service.event.A.v1',
      'a.staging.orders',
      'staging_orders',
      'stagingorders',
    ];

    const carried = [
      ...names.map((name) => isPrefixedName('staging', name)),
      ...subjects.map((subject) => isPrefixedSubject('staging', subject)),
    ];

    expect(carried).toEqual(Array(names.length + subjects.length).fill(false));
  });

  test('with no prefix every name and subject carries it', () => {
    const carried = [
      isPrefixedName(null, 'orders-service'),
      isPrefixedSubject(null, 'orders-service.event.A.v1'),
    ];

    expect(carried).toEqual([true, true]);
  });

  test('a prefix is kebab-case, as a Service name is', () => {
    const texts = ['staging', 'pr-123', 'stag_ing', 'a.b', '*', '>', 'Staging', '', 'a b'];

    const accepted = texts.map(isBrokerPrefix);

    expect(accepted).toEqual([true, true, false, false, false, false, false, false, false]);
  });

  test('a prefix has at most 64 characters, as a Service name has', () => {
    const accepted = [isBrokerPrefix('a'.repeat(64)), isBrokerPrefix('a'.repeat(65))];

    expect(accepted).toEqual([true, false]);
  });

  test('a broker message id is <event|command>.<Name>.v<n>:<factId>', () => {
    const messageIds = [
      brokerMessageIdOf(orderCreatedV2, 'o-1:created'),
      brokerMessageIdOf(chargeCardV1, 'o-1'),
    ];

    expect(messageIds).toEqual(['event.OrderCreated.v2:o-1:created', 'command.ChargeCard.v1:o-1']);
  });

  test('broker message ids are distinct for every kind, name, version and Fact id', () => {
    const tuples = messageTuples();

    const messageIds = new Set(
      tuples.map(({ message, factId }) => brokerMessageIdOf(message, factId)),
    );

    expect(messageIds.size).toBe(tuples.length);
  });

  test('a broker message id is the Message’s subject after the Service’s name, then the Fact id', () => {
    const tuples = messageTuples();

    const subjectsWithFactId = tuples.map(
      ({ message, factId }) => `${subjectOf('orders-service', message)}:${factId}`,
    );
    const serviceWithMessageId = tuples.map(
      ({ message, factId }) => `orders-service.${brokerMessageIdOf(message, factId)}`,
    );

    expect(serviceWithMessageId).toEqual(subjectsWithFactId);
  });

  test('a transport header in cf-loom’s or NATS’s namespace is reserved in any case', () => {
    const reservedNames = [
      'Nats-Msg-Id',
      'nats-msg-id',
      'Cf-Loom-Fact-Id',
      'CF-LOOM-FACT-ID',
      'Cf-Loom-Tenant',
      'Nats-TTL',
      'nats-expected-stream',
      'NATS-ROLLUP',
    ];
    const otherNames = ['traceparent', 'Nats', 'NatsTTL', 'X-Nats-Id', 'Cf-Loom'];

    const fits = [...reservedNames, ...otherNames].map((name) => transportHeaderFitOf(name, 'x'));

    expect(fits).toEqual([
      ...reservedNames.map(() => 'reserved-name'),
      ...otherNames.map(() => 'travels'),
    ]);
  });

  test('a transport header name NATS cannot carry is refused', () => {
    const uncarriedNames = [
      'a:b',
      'trace id',
      'a\tb',
      'a\u0001b',
      'a\u007fb',
      'café',
      'a\uD800',
      '',
    ];

    const fits = [...uncarriedNames, 'x-b3_trace.id!~'].map((name) =>
      transportHeaderFitOf(name, 'x'),
    );

    expect(fits).toEqual([...uncarriedNames.map(() => 'uncarried-name'), 'travels']);
  });

  test('a transport header value NATS would not carry as given is refused', () => {
    const uncarriedValues = [
      'a\rb',
      'a\nb',
      ' x',
      'x ',
      '\tx',
      'x\t',
      '\u00a0x',
      'x\ufeff',
      '\u3000x',
      'x\uD800',
      1,
      undefined,
    ];
    const carriedValues = ['a b', 'a\tb', '日本 café', 'a\u0001b', ''];

    const fits = [...uncarriedValues, ...carriedValues].map((value) =>
      transportHeaderFitOf('x-note', value),
    );

    expect(fits).toEqual([
      ...uncarriedValues.map(() => 'uncarried-value'),
      ...carriedValues.map(() => 'travels'),
    ]);
  });

  test('a Fact id or broker message id must be a non-empty header value NATS carries unchanged', () => {
    const refused = ['', ' o-1', 'o-1\n', 'o-1 ', 'o-1\uD800', 1, undefined];
    const accepted = ['o-1:created', 'pedido ñ\t1'];

    const verdicts = [...refused, ...accepted].map(isIdHeaderValue);

    expect(verdicts).toEqual([...refused.map(() => false), ...accepted.map(() => true)]);
  });

  test('a Message’s broker headers are its transport headers with its broker message id in Nats-Msg-Id and its Fact id in Cf-Loom-Fact-Id', () => {
    const message = {
      messageId: 'event.OrderCreated.v2:o-1:created',
      factId: 'o-1:created',
      headers: { traceparent: '00-abc-def-01' },
    };

    const headers = brokerHeadersOf(message);

    expect(headers).toEqual({
      traceparent: '00-abc-def-01',
      'Nats-Msg-Id': 'event.OrderCreated.v2:o-1:created',
      'Cf-Loom-Fact-Id': 'o-1:created',
    });
  });

  test('the broker message id travels in Nats-Msg-Id and the Fact id in Cf-Loom-Fact-Id', () => {
    expect([brokerMessageIdHeader, factIdHeader]).toEqual(['Nats-Msg-Id', 'Cf-Loom-Fact-Id']);
  });

  test('a Message’s broker headers take 12 bytes plus each header’s name, value and 4, as nats-core writes them', () => {
    const message = { messageId: 'event.OrderCreated.v1:o-1', factId: 'o-1', headers: {} };

    const bytes = [
      brokerHeaderBytesOf(message),
      brokerHeaderBytesOf({ ...message, headers: { traceparent: 'A' } }),
    ];

    expect(bytes).toEqual([74, 90]);
  });

  test('broker headers are counted in UTF-8 bytes, so a Fact id counts twice', () => {
    const ascii = { messageId: 'event.OrderCreated.v1:n', factId: 'n', headers: {} };
    const accented = { messageId: 'event.OrderCreated.v1:ñ', factId: 'ñ', headers: {} };

    const bytes = [brokerHeaderBytesOf(ascii), brokerHeaderBytesOf(accented)];

    expect(bytes).toEqual([70, 72]);
  });

  test('a Message’s broker headers read back give its broker message id, its Fact id and its transport headers', () => {
    const message = {
      messageId: 'event.OrderCreated.v2:o-1:created',
      factId: 'o-1:created',
      headers: { traceparent: '00-abc-def-01' },
    };
    const entries = Object.entries(brokerHeadersOf(message));

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({ kind: 'read', ...message });
  });

  test('broker headers without Cf-Loom-Fact-Id or Nats-Msg-Id, or with an empty one, read as missing, naming each', () => {
    const withoutFactId: [string, string][] = [['Nats-Msg-Id', 'event.OrderCreated.v2:o-1']];
    const withoutMessageId: [string, string][] = [['Cf-Loom-Fact-Id', 'o-1']];
    const emptyBoth: [string, string][] = [
      ['Nats-Msg-Id', ''],
      ['Cf-Loom-Fact-Id', ''],
    ];

    const reads = [withoutFactId, withoutMessageId, emptyBoth, []].map(receivedHeadersOf);

    expect(reads).toEqual([
      { kind: 'missing', names: ['Cf-Loom-Fact-Id'] },
      { kind: 'missing', names: ['Nats-Msg-Id'] },
      { kind: 'missing', names: ['Nats-Msg-Id', 'Cf-Loom-Fact-Id'] },
      { kind: 'missing', names: ['Nats-Msg-Id', 'Cf-Loom-Fact-Id'] },
    ]);
  });

  test('an id the Fact id’s rule refuses reads as missing', () => {
    const entries: [string, string][] = [
      ['Nats-Msg-Id', 'event.OrderCreated.v2:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1 '],
    ];

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({ kind: 'missing', names: ['Cf-Loom-Fact-Id'] });
  });

  test('a header named as one of cf-loom’s own in another case is neither an id nor a transport header', () => {
    const entries: [string, string][] = [
      ['Nats-Msg-Id', 'event.OrderCreated.v2:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
      ['nats-msg-id', 'other'],
      ['CF-LOOM-FACT-ID', 'other'],
      ['traceparent', '00-abc-def-01'],
    ];

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({
      kind: 'read',
      messageId: 'event.OrderCreated.v2:o-1',
      factId: 'o-1',
      headers: { traceparent: '00-abc-def-01' },
    });
  });

  test('broker headers in a namespace a transport header may not take read back as neither ids nor transport headers', () => {
    const entries: [string, string][] = [
      ['Nats-Msg-Id', 'event.OrderCreated.v2:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
      ['Nats-TTL', '1h'],
      ['nats-expected-stream', 'other'],
      ['Cf-Loom-Tenant', 't-1'],
      ['traceparent', '00-abc-def-01'],
    ];

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({
      kind: 'read',
      messageId: 'event.OrderCreated.v2:o-1',
      factId: 'o-1',
      headers: { traceparent: '00-abc-def-01' },
    });
  });

  test('a header given several values reads as one value, its values joined with ", "', () => {
    const entries: [string, string][] = [
      ['Nats-Msg-Id', 'event.OrderCreated.v2:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
      ['tracestate', 'a=1'],
      ['traceparent', '00-abc-def-01'],
      ['tracestate', 'b=2'],
    ];

    const read = receivedHeadersOf(entries);

    expect(read).toMatchObject({
      kind: 'read',
      headers: { traceparent: '00-abc-def-01', tracestate: 'a=1, b=2' },
    });
  });
});

const candidateLengths = Array.from({ length: 100 }, (_, index) => index + 1);

/** Subscription names of every length up to 100 characters, with every number of capitals each can have. */
function subscriptionCandidates(): readonly string[] {
  const names: string[] = [];
  for (const length of candidateLengths) {
    for (let capitals = 0; capitals <= (length - 1) / 2; capitals += 1) {
      names.push(`${'a'.repeat(length - 2 * capitals)}${'Bb'.repeat(capitals)}`);
    }
  }
  return names;
}

const serviceCandidates = candidateLengths.map((length) => 'a'.repeat(length));
const commandCandidates = candidateLengths.map((length) => `A${'a'.repeat(length - 1)}`);

/** The Subscription names and Command names, out of the candidates, that `generate` accepts in a Service. */
function acceptedNamesOf(subscriptionNames: readonly string[], commandNames: readonly string[]) {
  const subscriptions = subscriptionNames.map((name) =>
    defineSubscription({ name, description: 'Receives it', event: orderCreatedV2 }),
  );
  const commands = commandNames.map((name) =>
    defineCommand({ name, version: 1, description: 'A command', body: z.object({}) }),
  );
  const group = defineGroup({
    name: 'orders',
    description: 'Orders',
    events: [orderCreatedV2],
    commands,
    subscriptions,
  } as unknown as Parameters<typeof defineGroup>[0]);
  const root = defineService({ name: 'orders-service', groups: [group] });
  const validated = validateRoot(root, aRootPackage(root));
  const failures = validated.kind === 'invalid' ? validated.failures : [];
  const refusedSites = new Set<string>();
  for (const broken of failures) {
    if (broken.kind === 'declaration' && broken.rule === 'name-grammar') {
      refusedSites.add(siteTextOf(broken.site));
    }
  }
  return {
    subscriptions: subscriptionNames.filter((name) => !refusedSites.has(`subscriptions.${name}`)),
    commands: commandNames.filter((name) => !refusedSites.has(`commands.${name}@1`)),
  };
}

/** The names a Broker's names are made of, besides its prefix. */
type Named = {
  readonly service: string;
  readonly subscription: string;
  readonly command: string;
};

/** The Stream name and every Durable consumer name of one Service under a prefix. */
function derivedNamesOf(prefix: string | null, named: Named): readonly string[] {
  const { service, subscription, command } = named;
  const durable = [
    durableNameOf(service, { kind: 'subscription', name: subscription }),
    durableNameOf(service, { kind: 'command', name: command, version: Number.MAX_SAFE_INTEGER }),
  ];
  return [streamNameOf(service), ...durable].map((name) => prefixedNameOf(prefix, name));
}

const natsNameLimit = 255;

describe('the names derived from names the grammars accept', () => {
  test('every Stream and Durable consumer name at the longest names fits what NATS allows', () => {
    const service = serviceCandidates.filter((name) => follows(kebabCase, name)).at(-1) ?? '';
    const accepted = acceptedNamesOf(subscriptionCandidates(), commandCandidates);
    const command = accepted.commands.at(-1) ?? '';

    const derived = accepted.subscriptions.flatMap((subscription) =>
      derivedNamesOf(service, { service, subscription, command }),
    );

    expect(derived.filter((name) => name.length > natsNameLimit)).toEqual([]);
    expect(command).not.toBe('');
    expect(derived.length).toBe(accepted.subscriptions.length * 3);
  });

  test('any names the grammars accept, under any prefix one accepts, derive names NATS allows', () => {
    const next = seededNext(349);
    const draws = Array.from({ length: 3000 }, () => ({
      prefix: next() < 0.2 ? null : randomName(next, 'kebab'),
      service: randomName(next, 'kebab'),
      subscription: randomName(next, 'camel'),
      command: randomName(next, 'pascal'),
    }));
    const accepted = acceptedNamesOf(
      draws.map(({ subscription }) => subscription),
      draws.map(({ command }) => command),
    );
    const subscriptions = new Set(accepted.subscriptions);
    const commands = new Set(accepted.commands);
    const acceptedDraws = draws.filter(
      ({ prefix, service, subscription, command }) =>
        (prefix === null || isBrokerPrefix(prefix)) &&
        follows(kebabCase, service) &&
        subscriptions.has(subscription) &&
        commands.has(command),
    );

    const derived = acceptedDraws.flatMap(({ prefix, ...named }) => derivedNamesOf(prefix, named));

    expect(acceptedDraws.length).toBeGreaterThan(300);
    expect(derived.filter((name) => name.length > natsNameLimit)).toEqual([]);
  });
});

/** A name of the grammar built from random words, of any length up to 100 characters. */
function randomName(next: () => number, kind: 'kebab' | 'camel' | 'pascal'): string {
  const budget = 1 + Math.floor(next() * 100);
  const word = () => 'abcdefghijklmnopqrstuvwxyz0123456789'.slice(0, 2 + Math.floor(next() * 8));
  const capitalized = () => `${'ABCDEFGHIJ'.charAt(Math.floor(next() * 10))}${word()}`;
  const separator = kind === 'kebab' ? '-' : '';
  const nextWord = kind === 'kebab' ? word : capitalized;
  let name = kind === 'pascal' ? capitalized() : word();
  while (name.length < budget) {
    name = `${name}${separator}${nextWord()}`;
  }
  return name;
}
