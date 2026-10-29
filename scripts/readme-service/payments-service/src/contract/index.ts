import { defineService } from '@cf-loom/contract';
import { definitions } from '@org/definitions';
import { paymentsGroup } from './groups/payments.group.ts';

export const contract = defineService({
  name: 'payments-service',
  standardRejections: definitions,
  groups: [paymentsGroup],
});
