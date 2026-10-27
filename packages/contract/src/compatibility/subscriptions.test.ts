import { describe, expect, test } from 'vitest';
import { publishedBy } from '../../test/snapshots.ts';
import {
  type Change,
  type ChangeSite,
  type CodeSnapshot,
  compatibilityReportOf,
  type Difference,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
  type SubscriptionSnapshot,
  type SubscriptionTombstone,
} from '../internal/index.ts';

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  standardRejections,
  groups: {},
  defs: {},
  guards: {},
  codes: {},
  dependencies: {},
} as const;

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    ...heading,
    version: '3.4.0',
    generator: publishedBy,
    formerInputs: [],
    endpoints: {},
    events: {},
    commands: {},
    subscriptions: {},
    ...fields,
  };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return { ...heading, endpoints: {}, events: {}, commands: {}, subscriptions: {}, ...fields };
}

const orderLocked = 'ORDER_LOCKED';

function aSubscription(
  event = 'orders-service:OrderPlaced@1',
  description = 'Receives it',
): SubscriptionSnapshot {
  return { group: 'orders', description, event };
}

function aRemovedSubscription(event = 'orders-service:OrderPlaced@1'): SubscriptionTombstone {
  return { event, removedIn: '3.2.0' };
}

function aCode(status: number): CodeSnapshot {
  return {
    origin: 'local',
    status,
    message: 'The order is locked',
    headers: { type: 'object', fields: {} },
    body: null,
  };
}

function subscriptionSite(name: string): ChangeSite {
  return { kind: 'subscription', name, visibility: 'private' };
}

function neutral(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'neutral', verdict: 'allowed' };
}

function reportOf(baseline: PublishedServiceSnapshot, proposed: ServiceSnapshot) {
  return compatibilityReportOf(baseline, proposed);
}

function changesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const report = reportOf(baseline, proposed);
  return report.changes;
}

describe('compatibilityReportOf, Subscriptions', () => {
  test.each([
    {
      name: 'adding',
      baseline: aBaseline(),
      proposed: aProposed({ subscriptions: { notifyOnPlaced: aSubscription() } }),
      difference: { kind: 'added' },
    },
    {
      name: 'removing',
      baseline: aBaseline({ subscriptions: { notifyOnPlaced: aSubscription() } }),
      proposed: aProposed(),
      difference: { kind: 'removed' },
    },
  ] as const)(
    '$name a Subscription is one Neutral Change',
    ({ baseline, proposed, difference }) => {
      const changes = changesOf(baseline, proposed);

      expect(changes).toEqual([neutral(subscriptionSite('notifyOnPlaced'), difference)]);
    },
  );

  test('a Subscription tombstone the proposed Snapshot leaves out is no Change', () => {
    const baseline = aBaseline({ subscriptions: { legacySync: aRemovedSubscription() } });

    const report = reportOf(baseline, aProposed());

    expect(report).toEqual({ changes: [] });
  });

  test.each([
    { name: 'its old Event', event: 'orders-service:OrderPlaced@1' },
    { name: 'another Event', event: 'payments-service:PaymentSettled@1' },
  ])('declaring a removed Subscription’s name again with $name is refused', ({ event }) => {
    const baseline = aBaseline({ subscriptions: { legacySync: aRemovedSubscription() } });
    const proposed = aProposed({ subscriptions: { legacySync: aSubscription(event) } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: subscriptionSite('legacySync'),
        difference: { kind: 'identity-reused' },
        class: 'breaking',
        verdict: 'refused',
      },
    ]);
  });

  test.each([
    { name: 'another version', to: 'orders-service:OrderPlaced@2' },
    { name: 'another Service’s Event', to: 'payments-service:PaymentSettled@1' },
  ])('changing a Subscription’s Event to $name is refused, naming both', ({ to }) => {
    const baseline = aBaseline({ subscriptions: { notifyOnPlaced: aSubscription() } });
    const proposed = aProposed({ subscriptions: { notifyOnPlaced: aSubscription(to) } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: subscriptionSite('notifyOnPlaced'),
        difference: { kind: 'event-changed', from: 'orders-service:OrderPlaced@1', to },
        class: 'breaking',
        verdict: 'refused',
      },
    ]);
  });

  test('changing only a Subscription’s description is one Neutral description-changed', () => {
    const baseline = aBaseline({ subscriptions: { notifyOnPlaced: aSubscription() } });
    const reworded = aSubscription('orders-service:OrderPlaced@1', 'Tells the customer');
    const proposed = aProposed({ subscriptions: { notifyOnPlaced: reworded } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      neutral(subscriptionSite('notifyOnPlaced'), { kind: 'description-changed' }),
    ]);
  });

  test('moving a Subscription to another Group is one Neutral group-changed', () => {
    const baseline = aBaseline({ subscriptions: { notifyOnPlaced: aSubscription() } });
    const moved = { ...aSubscription(), group: 'billing' };
    const proposed = aProposed({ subscriptions: { notifyOnPlaced: moved } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      neutral(subscriptionSite('notifyOnPlaced'), {
        kind: 'group-changed',
        from: 'orders',
        to: 'billing',
      }),
    ]);
  });

  test('a Subscription whose Event is unchanged gives no Change', () => {
    const baseline = aBaseline({ subscriptions: { notifyOnPlaced: aSubscription() } });
    const proposed = aProposed({ subscriptions: { notifyOnPlaced: aSubscription() } });

    const report = reportOf(baseline, proposed);

    expect(report).toEqual({ changes: [] });
  });

  test('following a new Message Version with a new Subscription beside the old one adds only that Subscription', () => {
    const baseline = aBaseline({ subscriptions: { notifyOnPlaced: aSubscription() } });
    const proposed = aProposed({
      subscriptions: {
        notifyOnPlaced: aSubscription(),
        notifyOnPlacedV2: aSubscription('orders-service:OrderPlaced@2'),
      },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([neutral(subscriptionSite('notifyOnPlacedV2'), { kind: 'added' })]);
  });

  test('Subscription Changes come after codes, by name in code point order', () => {
    const baseline = aBaseline({
      codes: { [orderLocked]: aCode(409) },
      subscriptions: {
        bSync: aSubscription(),
        aSync: aSubscription(),
        cSync: aRemovedSubscription(),
      },
    });
    const proposed = aProposed({
      codes: { [orderLocked]: aCode(422) },
      subscriptions: {
        bSync: aSubscription('orders-service:OrderPlaced@2'),
        aSync: aSubscription('orders-service:OrderPlaced@3'),
        cSync: aSubscription(),
      },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ site, difference }) => [site.kind, difference.kind])).toEqual([
      ['code', 'status-changed'],
      ['subscription', 'event-changed'],
      ['subscription', 'event-changed'],
      ['subscription', 'identity-reused'],
    ]);
    expect(changes.slice(1).map(({ site }) => site)).toEqual([
      subscriptionSite('aSync'),
      subscriptionSite('bSync'),
      subscriptionSite('cSync'),
    ]);
  });
});
