import { defineEndpoint, notFound } from '@cf-loom/contract';
import { apiKey } from '@org/definitions';
import { z } from 'zod';

export const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  guards: [apiKey],
  input: { params: z.object({ paymentId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string(), amount: z.int() }) },
  rejections: [notFound],
});
