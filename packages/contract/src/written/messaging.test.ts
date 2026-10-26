import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { ping, pingedV1, pingService } from '../../test/ping-package.ts';
import { defineDependency, defineEvent, defineGroup, defineService } from '../index.ts';
import { eventServiceOf } from '../internal/index.ts';

const orderShippedV1 = defineEvent({
  name: 'OrderShipped',
  version: 1,
  visibility: 'internal',
  description: 'An order was shipped',
  body: z.object({ orderId: z.uuid() }),
});

/** A Contract whose Group lists Events as a cast lets an author write them, and which depends on a Provider. */
function aContractListing(events: readonly unknown[], provider: typeof pingService) {
  const group = defineGroup({
    name: 'billing',
    description: 'Billing',
    events,
  } as unknown as Parameters<typeof defineGroup>[0]);
  const dependency = defineDependency({ provider, endpoints: [ping] });
  return defineService({ name: 'billing-service', groups: [group], dependencies: [dependency] });
}

describe('eventServiceOf', () => {
  test('a Provider’s Event that a Group also lists is still the Provider’s', () => {
    const contract = aContractListing([orderShippedV1, pingedV1], pingService);

    const service = eventServiceOf(contract, pingedV1);

    expect(service).toBe('ping-service');
  });

  test('an Event a Group lists is the Contract’s own', () => {
    const contract = aContractListing([orderShippedV1, pingedV1], pingService);

    const service = eventServiceOf(contract, orderShippedV1);

    expect(service).toBe('billing-service');
  });
});
