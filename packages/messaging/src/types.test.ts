import { defineCommand, defineContract, defineEvent, defineSubscription } from '@cf-loom/contract';
import { type HandlerMap, handle, type WithResources, withReader } from '@cf-loom/handlers';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  type ConsumedFault,
  type Messaging,
  type MessagingOptions,
  messaging,
} from './index.ts';

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'retired',
  description: 'An order was created',
  body: z.object({ orderId: z.string() }),
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created, with its total',
  body: z.object({ orderId: z.string(), total: z.number() }),
});

const orderCreatedV3 = defineEvent({
  name: 'OrderCreated',
  version: 3,
  visibility: 'internal',
  description: 'An order was created, with its total and currency',
  body: z.object({ orderId: z.string(), total: z.number(), currency: z.string() }),
});

const orderArchivedV1 = defineEvent({
  name: 'OrderArchived',
  version: 1,
  visibility: 'internal',
  lifecycle: 'retired',
  description: 'An order was archived',
  body: z.object({ orderId: z.string() }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  lifecycle: 'deprecated',
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.string() }),
});

const chargeCardV2 = defineCommand({
  name: 'ChargeCard',
  version: 2,
  description: 'Charges the order’s card, for an amount',
  body: z.object({ orderId: z.string(), amount: z.number() }),
});

const refundV1 = defineCommand({
  name: 'Refund',
  version: 1,
  lifecycle: 'deprecated',
  description: 'Refunds the order',
  body: z.object({ orderId: z.string() }),
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV3,
});

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1, orderCreatedV2, orderCreatedV3, orderArchivedV1],
  commands: [chargeCardV1, chargeCardV2, refundV1],
  subscriptions: [notifyOnCreated],
});

const broker: Broker = {
  connect: async () => ({
    publish: async () => undefined,
    consume: async () => undefined,
    close: async () => undefined,
  }),
};

const { publisher, sender, consume } = await messaging(contract, broker);

const v2 = { orderId: 'o-1', total: 12 };

const v3 = { orderId: 'o-1', total: 12, currency: 'EUR' };

describe('publish and send types', () => {
  test('messaging() takes a Contract and a Broker and resolves to its Messaging', () => {
    const opening = messaging(contract, broker);

    expectTypeOf(opening).resolves.toEqualTypeOf<Messaging<typeof contract>>();
    expect(opening).toBeInstanceOf(Promise);
  });

  test('publish takes one body per Active and Deprecated version, keyed v<n>, each typed by its schema', () => {
    const publishing = () => publisher.publish('OrderCreated', { v2, v3 });

    const mistyped = () =>
      // @ts-expect-error: v3's body requires its currency
      publisher.publish('OrderCreated', { v2, v3: { orderId: 'o-1', total: 12 } });

    expect([publishing, mistyped]).toHaveLength(2);
  });

  test('leaving out a live version’s body is a type error', () => {
    // @ts-expect-error: the Deprecated v2 is still published
    const leftOut = () => publisher.publish('OrderCreated', { v3 });

    expect(leftOut).toBeTypeOf('function');
  });

  test('passing a Retired version’s body is a type error, even from a variable', () => {
    const bodies = { v1: { orderId: 'o-1' }, v2, v3 };

    // @ts-expect-error: v1 is Retired, so it is never published
    const retired = () => publisher.publish('OrderCreated', bodies);

    expect(retired).toBeTypeOf('function');
  });

  test('a name the root does not list, or whose every version is Retired, is a type error', () => {
    // @ts-expect-error: the root lists no OrderShipped
    const unlisted = () => publisher.publish('OrderShipped', {});
    // @ts-expect-error: OrderArchived's every version is Retired
    const archived = () => publisher.publish('OrderArchived', {});

    expect([unlisted, archived]).toHaveLength(2);
  });

  test('send takes a Command name with an Active version and that version’s body', () => {
    const sending = () => sender.send('ChargeCard', { orderId: 'o-1', amount: 12 });

    // @ts-expect-error: the Active ChargeCard@2 requires its amount
    const deprecatedBody = () => sender.send('ChargeCard', { orderId: 'o-1' });

    expect([sending, deprecatedBody]).toHaveLength(2);
  });

  test('a Command with no Active version is a type error to send', () => {
    // @ts-expect-error: Refund has no Active version
    const refunding = () => sender.send('Refund', { orderId: 'o-1' });

    expect(refunding).toBeTypeOf('function');
  });

  test('consume takes the Handler map; onServiceFault receives a ConsumedFault', () => {
    const notifying = handle(withReader(notifyOnCreated, orderCreatedV3.body), () => undefined);
    const consuming = () =>
      consume({ commands: {}, subscriptions: { notifyOnCreated: notifying } });

    expectTypeOf(consume)
      .parameter(0)
      .toEqualTypeOf<Pick<HandlerMap, 'commands' | 'subscriptions'>>();
    expectTypeOf<
      Parameters<NonNullable<MessagingOptions['onServiceFault']>>[0]
    >().toEqualTypeOf<ConsumedFault>();
    expect(consuming).toBeTypeOf('function');
  });

  test('consume without the Resources its Message Handlers take is a type error', () => {
    type Notifications = { readonly notifications: { readonly send: () => void } };
    const notifying = handle(
      withReader(notifyOnCreated, orderCreatedV3.body),
      (_body, _meta, { resources }: WithResources<Notifications>) => {
        resources.notifications.send();
      },
    );
    const handlers = { commands: {}, subscriptions: { notifyOnCreated: notifying } };
    const resources: Notifications = { notifications: { send: () => undefined } };

    const consuming = () => [
      consume(handlers, { resources }),
      // @ts-expect-error the Handler takes notifications
      consume(handlers),
      // @ts-expect-error the Handler takes notifications
      consume(handlers, { resources: {} }),
    ];

    expect(consuming).toBeTypeOf('function');
  });

  test('consume takes no options when no Message Handler takes Resources', () => {
    const notifying = handle(withReader(notifyOnCreated, orderCreatedV3.body), () => undefined);
    const stubbed = handle.stub(withReader(notifyOnCreated, orderCreatedV3.body));
    const handlers = { commands: {}, subscriptions: { notifyOnCreated: notifying } };

    const consuming = () => [
      consume(handlers),
      consume({ commands: {}, subscriptions: { notifyOnCreated: stubbed } }),
    ];

    expect(consuming).toBeTypeOf('function');
  });
});
