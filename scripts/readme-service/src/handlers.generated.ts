import type { HandlerMapOf } from '@cf-loom/handlers';
import chargeCardV1 from './commands/orders/charge-card.v1.handler.ts';
import type { contract } from './contract/index.ts';
import createOrder from './endpoints/orders/create-order.handler.ts';
import getOrder from './endpoints/orders/get-order.handler.ts';
import settlePayment from './endpoints/orders/settle-payment.handler.ts';
import apiKey from './guards/api-key.handler.ts';
import { readers } from './readers.generated.ts';
import notifyOnSettled from './subscriptions/orders/notify-on-settled.handler.ts';

export default {
  endpoints: { createOrder, getOrder, settlePayment },
  guards: { apiKey },
  commands: { chargeCardV1 },
  subscriptions: { notifyOnSettled },
  readers,
} satisfies HandlerMapOf<typeof contract>;
