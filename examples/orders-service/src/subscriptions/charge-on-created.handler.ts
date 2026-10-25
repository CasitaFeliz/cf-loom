import { handle } from '@cf-loom/handlers';
import { readers } from '../readers.generated.ts';
import type { Needs } from '../resources.ts';

export default handle(
  readers.subscriptions.chargeOnCreated,
  async ({ orderId, total }, _meta, { resources: { sender } }: Needs<'sender'>) => {
    await sender.send('ChargeCard', { orderId, total }, { factId: `${orderId}:charge` });
  },
);
