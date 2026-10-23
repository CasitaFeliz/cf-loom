import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineCommand, defineEvent, defineSubscription } from '../index.ts';
import {
  brokerMessageIdOf,
  durableNameOf,
  isBrokerPrefix,
  isReservedHeader,
  prefixedNameOf,
  prefixedSubjectOf,
  subjectOf,
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
      prefixedNameOf('staging', 'orders-service'),
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

    const names = [prefixedSubjectOf(null, subject), prefixedNameOf(null, 'orders-service')];

    expect(names).toEqual(['orders-service.event.OrderCreated.v2', 'orders-service']);
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

  test('both reserved header names are reserved in any case', () => {
    const names = [
      'Nats-Msg-Id',
      'nats-msg-id',
      'Cf-Loom-Fact-Id',
      'CF-LOOM-FACT-ID',
      'traceparent',
    ];

    const reserved = names.map(isReservedHeader);

    expect(reserved).toEqual([true, true, true, true, false]);
  });
});
