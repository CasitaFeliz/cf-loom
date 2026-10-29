import type { HandlerMapOf, NoResources } from '@cf-loom/handlers';
import chargeCardV1 from './commands/orders/charge-card.v1.handler.ts';
import type { contract } from './contract/index.ts';
import createOrder from './endpoints/orders/create-order.handler.ts';
import getOrder from './endpoints/orders/get-order.handler.ts';
import apiKey from './guards/api-key.handler.ts';
import { readers } from './readers.generated.ts';
import notifyOnSettled from './subscriptions/orders/notify-on-settled.handler.ts';

const handlers = {
  endpoints: { createOrder, getOrder },
  guards: { apiKey },
  commands: { chargeCardV1 },
  subscriptions: { notifyOnSettled },
  readers,
} satisfies HandlerMapOf<typeof contract>;

/**
 * Each README hands `serve` and `consume` the Resources of the Service it describes, and they
 * differ, so the map is typed as one whose Handlers take none; `satisfies` still checks that it
 * lists every Handler the Contract needs.
 */
export default handlers as unknown as HandlerMapOf<typeof contract, NoResources>;
