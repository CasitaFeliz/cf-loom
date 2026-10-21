import { handle } from '@cf-loom/handlers';
import { ordersMessaging } from '../messaging.ts';
import { chargeOnCreated } from '../readers.generated.ts';

export default handle(chargeOnCreated, async ({ orderId, total }) => {
  const { sender } = ordersMessaging();
  await sender.send('ChargeCard', { orderId, total }, { factId: `${orderId}:charge` });
});
