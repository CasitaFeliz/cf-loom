import { defineEvent, openEnum } from '@cf-loom/contract';
import { z } from 'zod';

export const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string(), method: openEnum(['card', 'transfer']) }),
});
