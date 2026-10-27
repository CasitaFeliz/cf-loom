import {
  type BodyOf,
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  openEnum,
} from '@cf-loom/contract';
import {
  type HandledBy,
  type HandlerMapOf,
  handle,
  type NoResources,
  readersOf,
  type WithResources,
} from '@cf-loom/handlers';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  type BrokerConnection,
  type BrokerConsumer,
  type BrokerService,
  type BrokerTrouble,
  type CloseOptions,
  type ConsumedFault,
  type ConsumeRun,
  type ConsumerTrouble,
  type Delivery,
  type Messaging,
  type MessagingOptions,
  messaging,
  type Settlement,
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

const orderPaidV1 = defineEvent({
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: z.object({ orderId: z.string(), method: openEnum(['card', 'transfer']) }),
});

const widenedVersion: number = 1;

const barWithWidenedVersion = defineEvent({
  name: 'Bar',
  version: widenedVersion,
  visibility: 'internal',
  description: 'A Bar whose version is typed number',
  body: z.object({ barId: z.string() }),
});

const quxWithRetiredWidenedVersion = defineEvent({
  name: 'Qux',
  version: widenedVersion,
  visibility: 'internal',
  lifecycle: 'retired',
  description: 'A retired Qux whose version is typed number',
  body: z.object({ quxId: z.string() }),
});

const quxV2 = defineEvent({
  name: 'Qux',
  version: 2,
  visibility: 'internal',
  description: 'A Qux with a literal version',
  body: z.object({ quxId: z.string() }),
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

const shipV1 = defineCommand({
  name: 'Ship',
  version: 1,
  description: 'Ships the order',
  body: z.object({ orderId: z.string() }),
});

const shipV2 = defineCommand({
  name: 'Ship',
  version: 2,
  description: 'Ships the order, again Active',
  body: z.object({ orderId: z.string() }),
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

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      events: [orderCreatedV1, orderCreatedV2],
      commands: [chargeCardV1],
    }),
    defineGroup({
      name: 'payments',
      description: 'Payments',
      events: [
        orderCreatedV3,
        orderPaidV1,
        orderArchivedV1,
        barWithWidenedVersion,
        quxWithRetiredWidenedVersion,
        quxV2,
      ],
      commands: [chargeCardV2, refundV1, shipV1, shipV2],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

const readers = readersOf({
  commands: {
    chargeCardV1: { element: chargeCardV1, reader: chargeCardV1.body },
    chargeCardV2: { element: chargeCardV2, reader: chargeCardV2.body },
    refundV1: { element: refundV1, reader: refundV1.body },
    shipV1: { element: shipV1, reader: shipV1.body },
    shipV2: { element: shipV2, reader: shipV2.body },
  },
  subscriptions: { notifyOnCreated: { element: notifyOnCreated, reader: orderCreatedV3.body } },
});

/** A stub for every Command's Message Version the Contract declares, none Retired. */
const commands = {
  chargeCardV1: handle.stub(readers.commands.chargeCardV1),
  chargeCardV2: handle.stub(readers.commands.chargeCardV2),
  refundV1: handle.stub(readers.commands.refundV1),
  shipV1: handle.stub(readers.commands.shipV1),
  shipV2: handle.stub(readers.commands.shipV2),
};

const broker: Broker = {
  connect: async () => ({
    publish: async () => ({ duplicate: false }),
    consume: async () => undefined,
    close: async () => undefined,
  }),
};

const { publisher, sender, consume } = await messaging(contract, broker);

const v2 = { orderId: 'o-1', total: 12 };

const v3 = { orderId: 'o-1', total: 12, currency: 'EUR' };

const fact = { factId: 'o-1' };

describe('publish and send types', () => {
  test('messaging() takes a Contract and a Broker and resolves to its Messaging', () => {
    const opening = messaging(contract, broker);

    expectTypeOf(opening).resolves.toEqualTypeOf<Messaging<typeof contract>>();
    expect(opening).toBeInstanceOf(Promise);
  });

  test('publish takes one body per Active and Deprecated version, keyed v<n>, each typed by its schema, whatever Group lists it', () => {
    const publishing = () => publisher.publish('OrderCreated', { v2, v3 }, fact);

    const mistyped = () =>
      // @ts-expect-error: v3's body requires its currency
      publisher.publish('OrderCreated', { v2, v3: { orderId: 'o-1', total: 12 } }, fact);

    expect([publishing, mistyped]).toHaveLength(2);
  });

  test('leaving out a live version’s body is a type error', () => {
    // @ts-expect-error: the Deprecated v2 is still published
    const leftOut = () => publisher.publish('OrderCreated', { v3 }, fact);

    expect(leftOut).toBeTypeOf('function');
  });

  test('passing a Retired version’s body is a type error, even from a variable', () => {
    const bodies = { v1: { orderId: 'o-1' }, v2, v3 };

    // @ts-expect-error: v1 is Retired, so it is never published
    const retired = () => publisher.publish('OrderCreated', bodies, fact);

    expect(retired).toBeTypeOf('function');
  });

  test('an Event whose version is typed number has no body key, so publishing it is a type error', () => {
    // @ts-expect-error: a version typed number keys no body
    const bare = () => publisher.publish('Bar', {}, fact);
    // @ts-expect-error: a version typed number keys no body, whatever is given
    const given = () => publisher.publish('Bar', { v1: { barId: 'b-1' } }, fact);

    expect([bare, given]).toHaveLength(2);
  });

  test('a Retired version typed number refuses the Event’s bodies with the reason, whatever its live versions', () => {
    type Bodies = Parameters<typeof publisher.publish<'Qux'>>[1];

    expectTypeOf<Bodies>().toEqualTypeOf<{
      readonly 'An Event version typed number keys no body: declare the version as one literal': never;
    }>();
  });

  test('a name the Root does not list, or whose every version is Retired, is a type error', () => {
    // @ts-expect-error: the Root lists no OrderShipped
    const unlisted = () => publisher.publish('OrderShipped', {}, fact);
    // @ts-expect-error: OrderArchived's every version is Retired
    const archived = () => publisher.publish('OrderArchived', {}, fact);

    expect([unlisted, archived]).toHaveLength(2);
  });

  test('send takes a Command name with an Active version and that version’s body, whatever Group lists it', () => {
    const sending = () => sender.send('ChargeCard', { orderId: 'o-1', amount: 12 }, fact);

    // @ts-expect-error: the Active ChargeCard@2 requires its amount
    const deprecatedBody = () => sender.send('ChargeCard', { orderId: 'o-1' }, fact);

    expect([sending, deprecatedBody]).toHaveLength(2);
  });

  test('publish takes BodyOf of each live version, an Open Enum’s Unknown case refused', () => {
    type Bodies = Parameters<typeof publisher.publish<'OrderCreated'>>[1];
    type Paid = Parameters<typeof publisher.publish<'OrderPaid'>>[1];

    expectTypeOf<Bodies>().toHaveProperty('v2').toEqualTypeOf<BodyOf<typeof orderCreatedV2>>();
    expectTypeOf<Bodies>().toHaveProperty('v3').toEqualTypeOf<BodyOf<typeof orderCreatedV3>>();
    expectTypeOf<Paid>().toHaveProperty('v1').toEqualTypeOf<BodyOf<typeof orderPaidV1>>();
    expectTypeOf<{ orderId: string; method: { unknown: string } }>().not.toExtend<Paid['v1']>();
  });

  test('send takes BodyOf of the Active version', () => {
    type Body = Parameters<typeof sender.send<'ChargeCard'>>[1];

    expectTypeOf<Body>().toEqualTypeOf<BodyOf<typeof chargeCardV2>>();
  });

  test('publish without a Fact id is a type error', () => {
    // @ts-expect-error: every call takes a Fact id
    const publishing = () => publisher.publish('OrderCreated', { v2, v3 }, {});

    expect(publishing).toBeTypeOf('function');
  });

  test('send without a Fact id is a type error', () => {
    // @ts-expect-error: every call takes a Fact id
    const sending = () => sender.send('ChargeCard', { orderId: 'o-1', amount: 12 }, {});

    expect(sending).toBeTypeOf('function');
  });

  test('send to a Command with two Active versions is a type error', () => {
    type Body = Parameters<typeof sender.send<'Ship'>>[1];

    // @ts-expect-error: Ship has two Active versions
    const shipping = () => sender.send('Ship', { orderId: 'o-1' }, fact);

    expectTypeOf<Body>().toEqualTypeOf<{
      readonly 'send() takes a Command with one Active version, which Ship is not: cf-loom generate refuses it': never;
    }>();
    expect(shipping).toBeTypeOf('function');
  });

  test('headers take undefined values', () => {
    const received: Readonly<Record<string, string>> = { traceparent: '00-abc-def-01' };
    const headers = { traceparent: received['traceparent'] };

    const sending = () =>
      sender.send('ChargeCard', { orderId: 'o-1', amount: 12 }, { ...fact, headers });

    expectTypeOf(headers.traceparent).toEqualTypeOf<string | undefined>();
    expect(sending).toBeTypeOf('function');
  });

  test('a Command with no Active version is a type error to send', () => {
    // @ts-expect-error: Refund has no Active version
    const refunding = () => sender.send('Refund', { orderId: 'o-1' }, fact);

    expect(refunding).toBeTypeOf('function');
  });

  test('consume takes the Handler map; onServiceFault receives a ConsumedFault', () => {
    const notifying = handle(readers.subscriptions.notifyOnCreated, () => undefined);
    const consuming = () =>
      consume({ commands, subscriptions: { notifyOnCreated: notifying }, readers }, {});

    expectTypeOf<
      Parameters<NonNullable<MessagingOptions['onServiceFault']>>[0]
    >().toEqualTypeOf<ConsumedFault>();
    expect(consuming).toBeTypeOf('function');
  });

  test('MessagingOptions takes an onBrokerTrouble that receives a BrokerTrouble', () => {
    const options: MessagingOptions = {
      onBrokerTrouble: async (trouble) => {
        expectTypeOf(trouble).toEqualTypeOf<BrokerTrouble>();
      },
    };

    expectTypeOf<BrokerTrouble['kind']>().toEqualTypeOf<'pull-failed' | 'recovered'>();
    expectTypeOf<Extract<BrokerTrouble, { kind: 'pull-failed' }>['cause']>().toBeUnknown();
    expectTypeOf<Omit<BrokerTrouble, 'kind' | 'cause'>>().toEqualTypeOf<{
      readonly element: BrokerTrouble['element'];
      readonly identity: string;
      readonly durable: string;
      readonly stream: string;
    }>();
    expect(options.onBrokerTrouble).toBeTypeOf('function');
  });

  test('close takes an optional signal', () => {
    expectTypeOf<Messaging<typeof contract>['close']>().toEqualTypeOf<
      (options?: CloseOptions) => Promise<void>
    >();
    expectTypeOf<CloseOptions>().toEqualTypeOf<{ readonly signal?: AbortSignal | undefined }>();
  });

  test('consume refuses a map that lacks a Command’s Message Version or a Subscription', () => {
    const notifying = handle(readers.subscriptions.notifyOnCreated, () => undefined);
    const { shipV2: _shipV2, ...withoutShipV2 } = commands;

    const consuming = () => [
      consume(
        // @ts-expect-error shipV2 has no Handler
        { commands: withoutShipV2, subscriptions: { notifyOnCreated: notifying }, readers },
        {},
      ),
      // @ts-expect-error notifyOnCreated has no Handler
      consume({ commands, subscriptions: {}, readers }, {}),
      consume({ commands, subscriptions: { notifyOnCreated: notifying }, readers }, {}),
    ];

    expect(consuming).toBeTypeOf('function');
  });

  test('consume without the Resources its Message Handlers take is a type error', () => {
    type Notifications = { readonly notifications: { readonly send: () => void } };
    const notifying = handle(
      readers.subscriptions.notifyOnCreated,
      (_body, _meta, { resources }: WithResources<Notifications>) => {
        resources.notifications.send();
      },
    );
    const handlers = { commands, subscriptions: { notifyOnCreated: notifying }, readers };
    const resources: Notifications = { notifications: { send: () => undefined } };

    const consuming = () => [
      consume(handlers, { resources }),
      // @ts-expect-error the Handler takes notifications
      consume(handlers, {}),
      // @ts-expect-error the Handler takes notifications
      consume(handlers, { resources: {} }),
    ];

    expect(consuming).toBeTypeOf('function');
  });

  test('consume takes a map annotated HandlerMapOf with the Resources, and refuses one annotated without them or with never', () => {
    type Notifications = { readonly notifications: { readonly send: () => void } };
    const notifying = handle(
      readers.subscriptions.notifyOnCreated,
      (_body, _meta, { resources }: WithResources<Notifications>) => {
        resources.notifications.send();
      },
    );
    const typed: HandlerMapOf<typeof contract, Notifications> = {
      endpoints: {},
      guards: {},
      commands,
      subscriptions: { notifyOnCreated: notifying },
      readers,
    };
    const annotated: HandlerMapOf<typeof contract> = typed;
    const neverMap: HandlerMapOf<typeof contract, never> = typed;
    const resources: Notifications = { notifications: { send: () => undefined } };

    const consuming = () => [
      consume(typed, { resources }),
      // @ts-expect-error the Handlers take the Service's Resources
      consume(typed, {}),
      // @ts-expect-error the Handlers take the Service's Resources
      consume(typed, {}),
      // @ts-expect-error the annotation leaves the Resources unspecified
      consume(annotated, {}),
      // @ts-expect-error the annotation leaves the Resources unspecified
      consume(annotated, { resources }),
      // @ts-expect-error the annotation leaves the Resources unspecified
      consume(neverMap, {}),
      // @ts-expect-error the annotation leaves the Resources unspecified
      consume(neverMap, { resources }),
    ];

    expect(consuming).toBeTypeOf('function');
  });

  test('a Subscription typed by its brand alone is refused, in a map annotated with the Resources or inferred', () => {
    type Notifications = { readonly notifications: { readonly send: () => void } };
    const notifying = handle(
      readers.subscriptions.notifyOnCreated,
      (_body, _meta, { resources }: WithResources<Notifications>) => {
        resources.notifications.send();
      },
    );
    const bare: HandledBy<typeof readers.subscriptions.notifyOnCreated.element> = notifying;
    const bareNever: HandledBy<typeof readers.subscriptions.notifyOnCreated.element, never> =
      notifying;
    const inferred = { commands, subscriptions: { notifyOnCreated: bare }, readers };
    const inferredNever = { commands, subscriptions: { notifyOnCreated: bareNever }, readers };
    const resources: Notifications = { notifications: { send: () => undefined } };

    const annotated = (): HandlerMapOf<typeof contract, Notifications> => ({
      endpoints: {},
      guards: {},
      commands,
      // @ts-expect-error the brand alone hides what notifyOnCreated takes
      subscriptions: { notifyOnCreated: bare },
      readers,
    });
    const consuming = () => [
      // @ts-expect-error the brand alone hides what notifyOnCreated takes
      consume(inferred, { resources }),
      // @ts-expect-error never hides what notifyOnCreated takes
      consume(inferredNever, { resources }),
    ];

    expect(annotated).toBeTypeOf('function');
    expect(consuming).toBeTypeOf('function');
  });

  test('a Service with no Resources types its map HandlerMapOf of the Contract and NoResources', () => {
    const notifying = handle(readers.subscriptions.notifyOnCreated, () => undefined);
    const none: HandlerMapOf<typeof contract, NoResources> = {
      endpoints: {},
      guards: {},
      commands,
      subscriptions: { notifyOnCreated: notifying },
      readers,
    };

    const consuming = () => [consume(none, {}), consume(none, { resources: {} })];

    expect(consuming).toBeTypeOf('function');
  });

  test('consume always takes its options, {} when no Message Handler takes Resources', () => {
    const notifying = handle(readers.subscriptions.notifyOnCreated, () => undefined);
    const stubbed = handle.stub(readers.subscriptions.notifyOnCreated);
    const handlers = { commands, subscriptions: { notifyOnCreated: notifying }, readers };

    const consuming = () => [
      consume(handlers, {}),
      consume({ commands, subscriptions: { notifyOnCreated: stubbed }, readers }, {}),
      // @ts-expect-error consume always takes its options
      consume(handlers),
    ];

    expect(consuming).toBeTypeOf('function');
  });
});

describe('the Broker seam', () => {
  test('a Broker adapter implements connect with only the stream and subjects', () => {
    expectTypeOf<keyof BrokerService>().toEqualTypeOf<'stream' | 'subjects'>();
  });

  test('a BrokerConsumer offers an adapter only its durable consumer, stream, subject and receive', () => {
    expectTypeOf<keyof BrokerConsumer>().toEqualTypeOf<
      'durable' | 'stream' | 'subject' | 'receive'
    >();
  });

  test('an adapter’s consume receives the consumers and a ConsumeRun of closing and troubled', () => {
    expectTypeOf<Parameters<BrokerConnection['consume']>>().toEqualTypeOf<
      [consumers: readonly BrokerConsumer[], run: ConsumeRun]
    >();
    expectTypeOf<ConsumeRun>().toEqualTypeOf<{
      readonly closing: AbortSignal;
      readonly troubled: (trouble: ConsumerTrouble) => void;
    }>();
    expectTypeOf<ConsumerTrouble>().toEqualTypeOf<
      { readonly consumer: BrokerConsumer } & (
        | { readonly kind: 'pull-failed'; readonly cause: unknown }
        | { readonly kind: 'recovered' }
      )
    >();
  });

  test('a Settlement is acked, pending, ended or handed-back', () => {
    expectTypeOf<Settlement>().toEqualTypeOf<'acked' | 'pending' | 'ended' | 'handed-back'>();
  });

  test('a Delivery says its waitMs, a number or undefined', () => {
    expectTypeOf<Delivery['waitMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<keyof Delivery>().toEqualTypeOf<
      'messageId' | 'factId' | 'deliveryCount' | 'lastAttempt' | 'waitMs' | 'headers' | 'body'
    >();
  });
});
