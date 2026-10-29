import { handle } from '@cf-loom/handlers';
import { readers } from '../../readers.generated.ts';
import { charged } from '../../service-code.ts';

export default handle(readers.commands.chargeCardV1, async ({ orderId }) => {
  charged.push(orderId);
});
