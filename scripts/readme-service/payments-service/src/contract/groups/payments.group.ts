import { defineGroup } from '@cf-loom/contract';
import { createPayment } from '../endpoints/payments/create-payment.endpoint.ts';
import { getPayment } from '../endpoints/payments/get-payment.endpoint.ts';

export const paymentsGroup = defineGroup({
  name: 'payments',
  description: 'Payments',
  endpoints: [getPayment, createPayment],
});
