import { handle } from '@cf-loom/handlers';
import { chargeOnce } from '../charges/charges.ts';
import { readers } from '../readers.generated.ts';

export default handle(readers.commands.chargeCardV1, ({ orderId, total }) => {
  chargeOnce(orderId, total);
});
