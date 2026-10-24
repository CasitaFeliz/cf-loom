import { handle } from '@cf-loom/handlers';
import { chargeOnCreated } from '../readers.generated.ts';
import type { Needs } from '../resources.ts';

export default handle(
  chargeOnCreated,
  async ({ orderId, total }, _meta, { resources: { sender } }: Needs<'sender'>) => {
    await sender.send('ChargeCard', { orderId, total }, { factId: `${orderId}:charge` });
  },
);
