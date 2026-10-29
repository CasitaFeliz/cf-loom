import { handle } from '@cf-loom/handlers';
import { readers } from '../../readers.generated.ts';

export default handle(readers.commands.chargeCardV1, async () => undefined);
