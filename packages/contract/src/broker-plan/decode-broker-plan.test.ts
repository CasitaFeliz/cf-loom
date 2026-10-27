import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import { defineCommand, defineEvent, defineGroup, defineService } from '../index.ts';
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

function aServicePlan(prefix: string | null): BrokerPlan {
  const root = defineService({
    name: 'orders-service',
    groups: [
      defineGroup({
        name: 'messages',
        description: 'Messages',
        events: [orderCreatedV1],
        commands: [chargeCardV1],
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

const ordersStream = 'staging_orders-service';
const invoiceDurableConsumer = 'staging_billing-service_draft-invoice';
const orderCreated = 'staging.orders-service.event.OrderCreated.v1';

function aPlan(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prefix: 'staging',
    streams: { [ordersStream]: { service: 'orders-service', subjects: [orderCreated] } },
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

/** A prefixed plan with one stream, whose fields are `fields` over the valid ones. */
function aPlanWithStream(fields: Record<string, unknown>, name = ordersStream) {
  const stream = { service: 'orders-service', subjects: [orderCreated], ...fields };
  return aPlan({ streams: { [name]: stream } });
}

/** A prefixed plan with one Durable consumer, whose fields are `fields` over the valid ones. */
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

  test('a prefixed plan whose names and subjects carry its prefix decodes', () => {
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
      'version is a key the broker plan does not define',
    ],
    [
      'a stream with a key the shape does not have',
      aPlanWithStream({ retention: 'limits' }),
      `streams.${ordersStream}.retention is a key the broker plan does not define`,
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
      `durableConsumers.${invoiceDurableConsumer}.ackWait is a key the broker plan does not define`,
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

  test('a plan without a prefix asks no name or subject to carry one', () => {
    const plan = {
      prefix: null,
      streams: { 'orders-service': { service: 'orders-service', subjects: ['orders-service.x'] } },
      durableConsumers: {},
    };

    expect(decodeBrokerPlan(plan)).toEqual({ kind: 'decoded', plan });
  });
});
