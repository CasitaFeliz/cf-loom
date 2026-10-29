import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { pingedV1 } from '../../test/ping-package.ts';
import { defineEvent, defineGroup, defineService, providedEvent } from '../index.ts';
import { eventServiceOf } from '../internal/index.ts';

const orderShippedV1 = defineEvent({
  name: 'OrderShipped',
  version: 1,
  visibility: 'internal',
  description: 'An order was shipped',
  body: z.object({ orderId: z.uuid() }),
});

/** A Contract whose Group lists Events as a cast lets an author write them. */
function aContractListing(events: readonly unknown[]) {
  const group = defineGroup({
    name: 'billing',
    description: 'Billing',
    events,
  } as unknown as Parameters<typeof defineGroup>[0]);
  return defineService({ name: 'billing-service', groups: [group] });
}

describe('eventServiceOf', () => {
  test('a Provider’s Event that a Group also lists is still the Provider’s', () => {
    const contract = aContractListing([orderShippedV1, pingedV1]);

    const service = eventServiceOf(contract, pingedV1);

    expect(service).toBe('ping-service');
  });

  test('an Event a Group lists is the Contract’s own', () => {
    const contract = aContractListing([orderShippedV1, pingedV1]);

    const service = eventServiceOf(contract, orderShippedV1);

    expect(service).toBe('billing-service');
  });

  test('an Event of the Contract’s own Contract Package has no Service, since a Provider is another Service', () => {
    const ownProvided = providedEvent('billing-service', {
      name: 'OrderShipped',
      version: 1,
      visibility: 'internal',
      description: 'An order was shipped',
      body: z.object({ orderId: z.uuid() }),
    });
    const contract = aContractListing([orderShippedV1]);

    const service = eventServiceOf(contract, ownProvided);

    expect(service).toBeUndefined();
  });
});
