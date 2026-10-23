import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineCommand, defineEvent, defineSubscription } from '../index.ts';
import {
  brokerHeaderBytesOf,
  brokerHeadersOf,
  brokerMessageIdOf,
  durableNameOf,
  isBrokerPrefix,
  isIdHeaderValue,
  isPrefixedName,
  isPrefixedSubject,
  prefixedNameOf,
  prefixedSubjectOf,
  receivedHeadersOf,
  streamNameOf,
  subjectOf,
  transportHeaderFitOf,
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

const notifyOnCreated = defineSubscription({ name: 'notify-on-created', event: orderCreatedV2 });

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

  test('a Subscription’s durable consumer is <service>_<name> and a Command Version’s <service>_command_<Name>_v<n>', () => {
    const durables = [
      durableNameOf('orders-service', notifyOnCreated),
      durableNameOf('orders-service', chargeCardV1),
    ];

    expect(durables).toEqual([
      'orders-service_notify-on-created',
      'orders-service_command_ChargeCard_v1',
    ]);
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

  test('a broker message id is <Name>.v<n>:<factId>', () => {
    const messageId = brokerMessageIdOf(orderCreatedV2, 'o-1:created');

    expect(messageId).toBe('OrderCreated.v2:o-1:created');
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
      messageId: 'OrderCreated.v2:o-1:created',
      factId: 'o-1:created',
      headers: { traceparent: '00-abc-def-01' },
    };

    const headers = brokerHeadersOf(message);

    expect(headers).toEqual({
      traceparent: '00-abc-def-01',
      'Nats-Msg-Id': 'OrderCreated.v2:o-1:created',
      'Cf-Loom-Fact-Id': 'o-1:created',
    });
  });

  test('a Message’s broker headers take 12 bytes plus each header’s name, value and 4, as nats-core writes them', () => {
    const message = { messageId: 'OrderCreated.v1:o-1', factId: 'o-1', headers: {} };

    const bytes = [
      brokerHeaderBytesOf(message),
      brokerHeaderBytesOf({ ...message, headers: { traceparent: 'A' } }),
    ];

    expect(bytes).toEqual([68, 84]);
  });

  test('broker headers are counted in UTF-8 bytes, so a Fact id counts twice', () => {
    const ascii = { messageId: 'OrderCreated.v1:n', factId: 'n', headers: {} };
    const accented = { messageId: 'OrderCreated.v1:ñ', factId: 'ñ', headers: {} };

    const bytes = [brokerHeaderBytesOf(ascii), brokerHeaderBytesOf(accented)];

    expect(bytes).toEqual([64, 66]);
  });

  test('a Message’s broker headers read back give its broker message id, its Fact id and its transport headers', () => {
    const message = {
      messageId: 'OrderCreated.v2:o-1:created',
      factId: 'o-1:created',
      headers: { traceparent: '00-abc-def-01' },
    };
    const entries = Object.entries(brokerHeadersOf(message));

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({ kind: 'read', ...message });
  });

  test('broker headers without Cf-Loom-Fact-Id or Nats-Msg-Id, or with an empty one, read as missing, naming each', () => {
    const withoutFactId: [string, string][] = [['Nats-Msg-Id', 'OrderCreated.v2:o-1']];
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
      ['Nats-Msg-Id', 'OrderCreated.v2:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1 '],
    ];

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({ kind: 'missing', names: ['Cf-Loom-Fact-Id'] });
  });

  test('a header named as one of cf-loom’s own in another case is neither an id nor a transport header', () => {
    const entries: [string, string][] = [
      ['Nats-Msg-Id', 'OrderCreated.v2:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
      ['nats-msg-id', 'other'],
      ['CF-LOOM-FACT-ID', 'other'],
      ['traceparent', '00-abc-def-01'],
    ];

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({
      kind: 'read',
      messageId: 'OrderCreated.v2:o-1',
      factId: 'o-1',
      headers: { traceparent: '00-abc-def-01' },
    });
  });

  test('broker headers in a namespace a transport header may not take read back as neither ids nor transport headers', () => {
    const entries: [string, string][] = [
      ['Nats-Msg-Id', 'OrderCreated.v2:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
      ['Nats-TTL', '1h'],
      ['nats-expected-stream', 'other'],
      ['Cf-Loom-Tenant', 't-1'],
      ['traceparent', '00-abc-def-01'],
    ];

    const read = receivedHeadersOf(entries);

    expect(read).toEqual({
      kind: 'read',
      messageId: 'OrderCreated.v2:o-1',
      factId: 'o-1',
      headers: { traceparent: '00-abc-def-01' },
    });
  });

  test('a header given several values reads as one value, its values joined with ", "', () => {
    const entries: [string, string][] = [
      ['Nats-Msg-Id', 'OrderCreated.v2:o-1'],
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
