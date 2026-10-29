import { handle, success } from '@cf-loom/handlers';
import { health } from '../../contract/endpoints/infrastructure/health.endpoint.ts';

export default handle(health, async () => success(health, { up: true }));
