import { defineService } from '@cf-loom/contract';
import { definitions as orgDefinitions } from '@org/definitions';
import { ordersDependency } from './dependencies/orders-service.dependency.ts';
import { billingGroup } from './groups/billing.group.ts';

export const contract = defineService({
  name: 'billing-service',
  groups: [billingGroup],
  dependencies: [ordersDependency],
  standardRejections: orgDefinitions,
});
