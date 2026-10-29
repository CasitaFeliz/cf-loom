import { openEnumReader, providedEndpoint, providedEvent } from '@cf-loom/contract';
import { z } from 'zod';

const payments = {
  name: 'payments-service',
  standardRejections: {
    invalidInput: {
      code: 'BAD_REQUEST',
      status: 400,
      message: 'The request is invalid',
      body: z.object({ issues: z.array(z.object({ message: z.string() })) }),
    },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
} as const;

export const getPaymentEndpoint = providedEndpoint(
  payments,
  {
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'public',
    description: 'One payment by id',
    input: { params: z.object({ paymentId: z.string() }) },
    success: { status: 200, body: z.object({ paymentId: z.string() }) },
  },
  null,
);

export const paymentSettledEventV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string(), method: openEnumReader(['card', 'transfer']) }),
});
