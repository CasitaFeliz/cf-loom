import { type HandlerMapOf, readersOf } from '@cf-loom/handlers';
import type { contract } from './contract/index.ts';
import createPayment from './endpoints/payments/create-payment.handler.ts';
import getPayment from './endpoints/payments/get-payment.handler.ts';
import apiKey from './guards/api-key.handler.ts';
import idempotencyKey from './guards/idempotency-key.handler.ts';

export default {
  endpoints: { getPayment, createPayment },
  guards: { apiKey, idempotencyKey },
  commands: {},
  subscriptions: {},
  readers: readersOf({ commands: {}, subscriptions: {} }),
} satisfies HandlerMapOf<typeof contract>;
