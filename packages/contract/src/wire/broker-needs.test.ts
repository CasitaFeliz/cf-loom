import { describe, expect, test } from 'vitest';
import { brokerNeedsOf } from '../internal/index.ts';

const event = (version: number, lifecycle: 'active' | 'deprecated' | 'retired') =>
  ({ kind: 'event', name: 'OrderCreated', version, lifecycle }) as const;

const command = (version: number, lifecycle: 'active' | 'deprecated' | 'retired') =>
  ({ kind: 'command', name: 'ShipOrder', version, lifecycle }) as const;

describe('brokerNeedsOf', () => {
  test('a Deprecated Command keeps its Durable consumer and its subject, and a Retired one has neither', () => {
    const messages = [command(1, 'retired'), command(2, 'deprecated'), command(3, 'active')];

    const needs = brokerNeedsOf('shop-service', messages, []);

    expect(needs.streamSubjects).toEqual([
      'shop-service.command.ShipOrder.v2',
      'shop-service.command.ShipOrder.v3',
    ]);
    expect(needs.durableConsumers).toEqual([
      {
        from: messages[1],
        durable: 'shop-service_command_ShipOrder_v2',
        stream: 'shop-service',
        subject: 'shop-service.command.ShipOrder.v2',
      },
      {
        from: messages[2],
        durable: 'shop-service_command_ShipOrder_v3',
        stream: 'shop-service',
        subject: 'shop-service.command.ShipOrder.v3',
      },
    ]);
  });

  test('a live Event has a subject on the stream and no Durable consumer', () => {
    const messages = [event(1, 'retired'), event(2, 'deprecated'), event(3, 'active')];

    const needs = brokerNeedsOf('shop-service', messages, []);

    expect(needs.streamSubjects).toEqual([
      'shop-service.event.OrderCreated.v2',
      'shop-service.event.OrderCreated.v3',
    ]);
    expect(needs.durableConsumers).toEqual([]);
  });

  test('a Subscription has a Durable consumer on its Provider stream, whatever its Event', () => {
    const subscription = {
      name: 'paymentSettled',
      provider: 'payments-service',
      event: { name: 'PaymentSettled', version: 2 },
    };

    const needs = brokerNeedsOf('shop-service', [], [subscription]);

    expect(needs.streamSubjects).toEqual([]);
    expect(needs.durableConsumers).toEqual([
      {
        from: subscription,
        durable: 'shop-service_payment-settled',
        stream: 'payments-service',
        subject: 'payments-service.event.PaymentSettled.v2',
      },
    ]);
  });

  test('a Subscription to its own Service’s Event keeps that Event’s subject on the stream, once, live Message Version or not', () => {
    const own = {
      name: 'orderCreated',
      provider: 'shop-service',
      event: { name: 'OrderCreated', version: 1 },
    };

    const live = brokerNeedsOf('shop-service', [event(1, 'active')], [own]);
    const unlisted = brokerNeedsOf('shop-service', [], [own]);

    expect(live.streamSubjects).toEqual(['shop-service.event.OrderCreated.v1']);
    expect(unlisted.streamSubjects).toEqual(['shop-service.event.OrderCreated.v1']);
  });

  test('a Message Version that declares no lifecycle is Active', () => {
    const declared = { kind: 'command', name: 'ShipOrder', version: 1 } as const;

    const needs = brokerNeedsOf('shop-service', [declared], []);

    expect(needs.streamSubjects).toEqual(['shop-service.command.ShipOrder.v1']);
  });
});
