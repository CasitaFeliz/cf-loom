import { defineContract } from '@cf-loom/contract';
import { definitions as orgDefinitions } from '@org/definitions';
import { ordersDeps } from './dependencies/orders-service.dependencies.ts';
import { invoicesGroup } from './endpoints/invoices/invoices.group.ts';

export const contract = defineContract({
  name: 'billing-service',
  groups: [invoicesGroup],
  dependencies: [ordersDeps],
  definitions: [orgDefinitions],
});
