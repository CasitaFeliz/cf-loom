import { defineContract } from '@cf-loom/contract';
import { definitions as orgDefinitions } from '@org/definitions';
import { ordersDeps } from './dependencies/orders-service.dependencies.ts';
import { billingGroup } from './groups/billing.group.ts';

export const contract = defineContract({
  name: 'billing-service',
  groups: [billingGroup],
  dependencies: [ordersDeps],
  definitions: [orgDefinitions],
});
