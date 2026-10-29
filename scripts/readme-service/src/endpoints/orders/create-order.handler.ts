import { handle, success } from '@cf-loom/handlers';
import { createOrder } from '../../contract/endpoints/orders/create-order.endpoint.ts';
import type { Needs } from '../../resources.ts';

export default handle(
  createOrder,
  async (_input, _call, { resources: { publisher } }: Needs<'publisher' | 'sender'>) => {
    void publisher;
    return success({ id: crypto.randomUUID() });
  },
);
