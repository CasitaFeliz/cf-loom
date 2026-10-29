import { defineGroup } from '@cf-loom/contract';
import { createPayment } from '../endpoints/payments/create-payment.endpoint.ts';
import { getPayment } from '../endpoints/payments/get-payment.endpoint.ts';
import { paymentSettledV1 } from '../events/payments/payment-settled.v1.event.ts';

export const paymentsGroup = defineGroup({
  name: 'payments',
  description: 'Payments',
  endpoints: [getPayment, createPayment],
  events: [paymentSettledV1],
});
