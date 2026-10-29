import { apiKey, money } from '@org/definitions';

export const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Places a pending order',
  guards: [apiKey],
  input: { body: z.object({ customerId: z.uuid(), total: money }) },
  success: { status: 201, body: z.object({ id: z.uuid() }) },
});
