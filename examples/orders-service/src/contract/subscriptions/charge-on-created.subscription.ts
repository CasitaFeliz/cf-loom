import { defineSubscription } from '@cf-loom/contract';
import { orderCreatedV1 } from '../events/order-created.v1.event.ts';

export const chargeOnCreated = defineSubscription({
  name: 'charge-on-created',
  event: orderCreatedV1,
});
