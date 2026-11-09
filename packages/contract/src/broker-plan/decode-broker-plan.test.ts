import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { lineBreaks } from '../../test/line-breaks.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  providedEvent,
} from '../index.ts';
import {
  type BrokerPlan,
  brokerPlanOf,
  decodeBrokerPlan,
  snapshotOf,
  validateRoot,
} from '../internal/index.ts';

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
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

const refundV1 = defineCommand({
  name: 'Refund',
  version: 1,
  description: 'Refunds the order’s card',
  body: z.object({ orderId: z.string() }),
});

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string() }),
});

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: paymentSettledV1,
});

/** The plan `cf-loom broker-plan` prints for orders-service: a Stream, a Durable consumer for each Command Version and one for its Subscription. */
function aServicePlan(prefix: string | null): BrokerPlan {
  const root = defineService({
    name: 'orders-service',
    groups: [
      defineGroup({
        name: 'messages',
        description: 'Messages',
        events: [orderCreatedV1],
        commands: [chargeCardV1, refundV1],
        subscriptions: [notifyOnSettled],
      }),
    ],
  });
  const validated = validateRoot(root, aRootPackage(root, { packageName: 'orders-service' }));
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return brokerPlanOf(snapshot, prefix);
}

/** The plan of `aServicePlan`, as JSON gives it back and a hand can edit it. */
type EditablePlan = {
  prefix: string | null;
  streams: Record<string, { service: string; subjects: string[] }>;
  durableConsumers: Record<string, { service: string; stream: string; subject: string }>;
};

function aPrintedPlan(prefix: string | null = null): EditablePlan {
  const printed: EditablePlan = JSON.parse(JSON.stringify(aServicePlan(prefix)));
  return printed;
}

const chargeCardConsumer = 'orders-service_command_ChargeCard_v1';
const refundSubject = 'orders-service.command.Refund.v1';

/** The plan with the fields of one Durable consumer it lists replaced. */
function withConsumer(
  plan: EditablePlan,
  name: string,
  fields: Partial<EditablePlan['durableConsumers'][string]>,
): EditablePlan {
  const consumer = plan.durableConsumers[name];
  if (consumer === undefined) {
    throw new Error(`The plan lists no Durable consumer ${name}`);
  }
  return {
    ...plan,
    durableConsumers: { ...plan.durableConsumers, [name]: { ...consumer, ...fields } },
  };
}

const ordersStream = 'staging_orders-service';
const invoiceDurableConsumer = 'staging_billing-service_draft-invoice';
const orderCreated = 'staging.orders-service.event.OrderCreated.v1';

function aPlan(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prefix: 'staging',
    streams: {},
    durableConsumers: {
      [invoiceDurableConsumer]: {
        service: 'billing-service',
        stream: ordersStream,
        subject: orderCreated,
      },
    },
    ...fields,
  };
}

/** A prefixed plan with one Stream and no Durable consumer, whose fields are `fields` over the valid ones. */
function aPlanWithStream(fields: Record<string, unknown>, name = ordersStream) {
  const stream = { service: 'orders-service', subjects: [orderCreated], ...fields };
  return aPlan({ streams: { [name]: stream }, durableConsumers: {} });
}

/** A prefixed plan with one Durable consumer and no Stream, whose fields are `fields` over the valid ones. */
function aPlanWithDurableConsumer(fields: Record<string, unknown>, name = invoiceDurableConsumer) {
  const durableConsumer = {
    service: 'billing-service',
    stream: ordersStream,
    subject: orderCreated,
    ...fields,
  };
  return aPlan({ durableConsumers: { [name]: durableConsumer } });
}

function malformed(reason: string) {
  return { kind: 'malformed', reason };
}

describe('reading a broker plan', () => {
  test.each([
    ['without a prefix', null],
    ['with a prefix', 'staging'],
  ])(
    'the plan cf-loom broker-plan --json prints, %s, parsed back, decodes to the same plan',
    (_, prefix) => {
      const printed = aServicePlan(prefix);

      const decoded = decodeBrokerPlan(JSON.parse(JSON.stringify(printed)));

      expect(decoded).toEqual({ kind: 'decoded', plan: printed });
    },
  );

  test('a plan with no stream and no Durable consumer decodes', () => {
    const plan = { prefix: null, streams: {}, durableConsumers: {} };

    expect(decodeBrokerPlan(plan)).toEqual({ kind: 'decoded', plan });
  });

  test('a Subscriber’s plan, whose Durable consumer reads another Service’s Stream and which has no Stream of its own, decodes', () => {
    const plan = aPlan();

    expect(decodeBrokerPlan(plan)).toEqual({ kind: 'decoded', plan });
  });

  test.each([
    ['something that is no object', 'a plan', '(root) is not an object'],
    ['the errors document broker-plan prints', { errors: ['no snapshot'] }, 'prefix is missing'],
    ['a plan with no prefix', { streams: {}, durableConsumers: {} }, 'prefix is missing'],
    ['a plan with no streams', { prefix: null, durableConsumers: {} }, 'streams is missing'],
    [
      'a plan with no Durable consumers',
      { prefix: null, streams: {} },
      'durableConsumers is missing',
    ],
    ['a plan whose prefix is no text', aPlan({ prefix: 1 }), 'prefix is not a text or null'],
    ['a plan whose streams are a list', aPlan({ streams: [] }), 'streams is not an object'],
    [
      'a plan with a key the shape does not have',
      aPlan({ version: 1 }),
      'version is a key the Broker plan does not define',
    ],
    [
      'a stream with a key the shape does not have',
      aPlanWithStream({ retention: 'limits' }),
      `streams.${ordersStream}.retention is a key the Broker plan does not define`,
    ],
    [
      'a stream with no service',
      aPlanWithStream({ service: undefined }),
      `streams.${ordersStream}.service is missing`,
    ],
    [
      'a stream that holds no subject',
      aPlanWithStream({ subjects: [] }),
      `streams.${ordersStream}.subjects holds no subject`,
    ],
    [
      'a stream whose subject is no text',
      aPlanWithStream({ subjects: [1] }),
      `streams.${ordersStream}.subjects.0 is not a text`,
    ],
    [
      'a Durable consumer with no stream',
      aPlanWithDurableConsumer({ stream: undefined }),
      `durableConsumers.${invoiceDurableConsumer}.stream is missing`,
    ],
    [
      'a Durable consumer with no subject',
      aPlanWithDurableConsumer({ subject: undefined }),
      `durableConsumers.${invoiceDurableConsumer}.subject is missing`,
    ],
    [
      'a Durable consumer with a key the shape does not have',
      aPlanWithDurableConsumer({ ackWait: '30s' }),
      `durableConsumers.${invoiceDurableConsumer}.ackWait is a key the Broker plan does not define`,
    ],
  ])('%s is malformed, naming where', (_, value, reason) => {
    expect(decodeBrokerPlan(value)).toEqual(malformed(reason));
  });

  test.each(['stag_ing', 'a.b', 'Staging', '', 'a'.repeat(65)])(
    'a plan whose prefix "%s" is not a Broker prefix is malformed',
    (prefix) => {
      const plan = { prefix, streams: {}, durableConsumers: {} };

      expect(decodeBrokerPlan(plan)).toEqual(
        malformed('prefix is not kebab-case of at most 64 characters, such as staging'),
      );
    },
  );

  test.each([
    [
      'a stream name',
      aPlanWithStream({}, 'orders-service'),
      'streams.orders-service does not carry the prefix staging',
    ],
    [
      'a stream subject',
      aPlanWithStream({ subjects: [orderCreated, 'orders-service.event.OrderCreated.v2'] }),
      `streams.${ordersStream}.subjects.1 does not carry the prefix staging`,
    ],
    [
      'a Durable consumer name',
      aPlanWithDurableConsumer({}, 'billing-service_draft-invoice'),
      'durableConsumers.billing-service_draft-invoice does not carry the prefix staging',
    ],
    [
      'a Durable consumer stream',
      aPlanWithDurableConsumer({ stream: 'orders-service' }),
      `durableConsumers.${invoiceDurableConsumer}.stream does not carry the prefix staging`,
    ],
    [
      'a Durable consumer subject',
      aPlanWithDurableConsumer({ subject: 'orders-service.event.OrderCreated.v1' }),
      `durableConsumers.${invoiceDurableConsumer}.subject does not carry the prefix staging`,
    ],
  ])(
    'a prefixed plan whose %s does not carry the prefix is malformed, naming it',
    (_, plan, reason) => {
      expect(decodeBrokerPlan(plan)).toEqual(malformed(reason));
    },
  );

  test.each([
    [
      'Stream',
      aPlan({
        streams: Object.fromEntries([
          ['__proto__', { service: 'orders-service', subjects: [orderCreated] }],
        ]),
      }),
      'streams.__proto__ is not a Stream name: a Service name after the prefix',
    ],
    [
      'Durable consumer',
      aPlan({
        durableConsumers: Object.fromEntries([
          [
            '__proto__',
            { service: 'billing-service', stream: ordersStream, subject: orderCreated },
          ],
        ]),
      }),
      'durableConsumers.__proto__ is not a Durable consumer name: a Service name, then a Subscription name or a Command Version',
    ],
  ])('a plan with a __proto__ %s is malformed, never decoded without it', (_, plan, reason) => {
    expect(decodeBrokerPlan(plan)).toEqual(malformed(reason));
  });

  test.for(lineBreaks)('a Stream named with %s is malformed, naming it', ([, code]) => {
    const name = `${ordersStream}${String.fromCharCode(code)}x`;

    const decoded = decodeBrokerPlan(aPlanWithStream({}, name));

    expect(decoded).toEqual(
      malformed(`streams.${name} is not a Stream name: a Service name after the prefix`),
    );
  });

  const notStreamName = 'is not a Stream name: a Service name after the prefix';
  const notDurableConsumerName =
    'is not a Durable consumer name: a Service name, then a Subscription name or a Command Version';
  const notSubject =
    'is not a subject: a Service name, event or command, a Message name and its version';

  const unreadableStreamNames = [
    '',
    'a.b',
    'Orders',
    'a b',
    '*',
    '>',
    '-a',
    'a--b',
    'a'.repeat(65),
  ].map((rest) => `staging_${rest}`);

  test.each(unreadableStreamNames)('a Stream named "%s" is malformed, naming it', (name) => {
    expect(decodeBrokerPlan(aPlanWithStream({}, name))).toEqual(
      malformed(`streams.${name} ${notStreamName}`),
    );
  });

  test.each(unreadableStreamNames)(
    'a Durable consumer reading the Stream "%s" is malformed, naming it',
    (stream) => {
      const decoded = decodeBrokerPlan(aPlanWithDurableConsumer({ stream }));

      expect(decoded).toEqual(
        malformed(`durableConsumers.${invoiceDurableConsumer}.stream ${notStreamName}`),
      );
    },
  );

  test.each([
    '',
    'billing-service',
    'billing-service_',
    '_draft-invoice',
    'Billing_draft-invoice',
    `${'a'.repeat(65)}_draft-invoice`,
    'billing-service_Draft',
    'billing-service_draft-Invoice',
    'billing-service_draft--invoice',
    'billing-service_draft-invoice-',
    'billing-service_draft_invoice',
    'billing-service_ x>',
    'billing-service_constructor',
    `billing-service_${'a'.repeat(65)}`,
    'billing-service_command_chargeCard_v1',
    'billing-service_command_ChargeCard_v0',
    'billing-service_command_ChargeCard_v01',
    'billing-service_command_ChargeCard_v',
    'billing-service_command_ChargeCard_1',
    'billing-service_command_ChargeCard_v9007199254740992',
  ])('a Durable consumer named "staging_%s" is malformed, naming it', (rest) => {
    const name = `staging_${rest}`;

    const decoded = decodeBrokerPlan(aPlanWithDurableConsumer({}, name));

    expect(decoded).toEqual(malformed(`durableConsumers.${name} ${notDurableConsumerName}`));
  });

  const unreadableSubjects = [
    '',
    '>',
    '*.event.*.v1',
    'orders-service.x',
    'orders-service.event.>',
    'orders-service.event.OrderCreated',
    'orders-service.event.OrderCreated.1',
    'orders-service.event.OrderCreated.v0',
    'orders-service.event.OrderCreated.v01',
    'orders-service.event.OrderCreated.v1e0',
    'orders-service.event.OrderCreated.v9007199254740992',
    'orders-service.event.OrderCreated.v1.x',
    'orders-service.query.OrderCreated.v1',
    'orders-service.event.orderCreated.v1',
    'Orders-service.event.OrderCreated.v1',
    `${'a'.repeat(65)}.event.OrderCreated.v1`,
  ].map((rest) => `staging.${rest}`);

  test.each(unreadableSubjects)(
    'a Stream holding the subject "%s" is malformed, naming it',
    (subject) => {
      const decoded = decodeBrokerPlan(aPlanWithStream({ subjects: [subject] }));

      expect(decoded).toEqual(malformed(`streams.${ordersStream}.subjects.0 ${notSubject}`));
    },
  );

  test.each(unreadableSubjects)(
    'a Durable consumer filtering on the subject "%s" is malformed, naming it',
    (subject) => {
      const decoded = decodeBrokerPlan(aPlanWithDurableConsumer({ subject }));

      expect(decoded).toEqual(
        malformed(`durableConsumers.${invoiceDurableConsumer}.subject ${notSubject}`),
      );
    },
  );

  const notServiceName = 'is not a Service name, kebab-case of at most 64 characters';

  const unreadableServiceNames = [
    '',
    'Not A Service\n',
    'Orders',
    'orders_service',
    'orders.service',
    'orders--service',
    'orders-service-',
    'staging_orders-service',
    'a'.repeat(65),
  ];

  test.each(unreadableServiceNames)(
    'a Stream whose service is "%s" is malformed, naming it',
    (service) => {
      const decoded = decodeBrokerPlan(aPlanWithStream({ service }));

      expect(decoded).toEqual(malformed(`streams.${ordersStream}.service ${notServiceName}`));
    },
  );

  test.each(unreadableServiceNames)(
    'a Durable consumer whose service is "%s" is malformed, naming it',
    (service) => {
      const decoded = decodeBrokerPlan(aPlanWithDurableConsumer({ service }));

      expect(decoded).toEqual(
        malformed(`durableConsumers.${invoiceDurableConsumer}.service ${notServiceName}`),
      );
    },
  );

  test('a Stream named after a Service named constructor decodes', () => {
    const plan = {
      prefix: null,
      streams: {
        constructor: { service: 'constructor', subjects: ['constructor.event.OrderCreated.v1'] },
      },
      durableConsumers: {},
    };

    expect(decodeBrokerPlan(plan)).toEqual({ kind: 'decoded', plan });
  });

  const reprinted = "is not what the plan's names print for orders-service";

  test('a plan that points a command’s Durable consumer at another Command Version’s subject is malformed, naming its subject', () => {
    const plan = withConsumer(aPrintedPlan(), chargeCardConsumer, { subject: refundSubject });

    const decoded = decodeBrokerPlan(plan);

    expect(decoded).toEqual(
      malformed(`durableConsumers.${chargeCardConsumer}.subject ${reprinted}`),
    );
  });

  test.each([
    [
      'Streams',
      (plan: EditablePlan): EditablePlan => ({
        ...plan,
        streams: {
          ...plan.streams,
          'payments-service': {
            service: 'payments-service',
            subjects: ['payments-service.event.PaymentSettled.v1'],
          },
        },
      }),
      'streams.payments-service',
    ],
    [
      'Durable consumers',
      (plan: EditablePlan): EditablePlan => ({
        ...plan,
        durableConsumers: {
          ...plan.durableConsumers,
          'payments-service_notify-on-created': {
            service: 'payments-service',
            stream: 'orders-service',
            subject: 'orders-service.event.OrderCreated.v1',
          },
        },
      }),
      'durableConsumers.payments-service_notify-on-created',
    ],
  ])(
    'a plan that merges the %s of two Services is malformed, naming the first entry of the second',
    (_, merge, at) => {
      const decoded = decodeBrokerPlan(merge(aPrintedPlan()));

      expect(decoded).toEqual(malformed(`${at} ${reprinted}`));
    },
  );

  test('a plan without a prefix asks no name or subject to carry one', () => {
    const plan = {
      prefix: null,
      streams: {
        'orders-service': {
          service: 'orders-service',
          subjects: ['orders-service.event.OrderCreated.v1'],
        },
      },
      durableConsumers: {},
    };

    expect(decodeBrokerPlan(plan)).toEqual({ kind: 'decoded', plan });
  });
});
