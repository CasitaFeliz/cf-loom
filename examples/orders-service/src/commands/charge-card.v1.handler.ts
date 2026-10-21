import { handle } from '@cf-loom/handlers';
import { chargeOnce } from '../charges/charges.ts';
import { chargeCardV1 } from '../readers.generated.ts';

export default handle(chargeCardV1, ({ orderId, total }) => {
  chargeOnce(orderId, total);
});
