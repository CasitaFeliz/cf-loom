import { handle, success } from '@casitafeliz/loom-handlers';
import { health } from '../../contract/endpoints/infrastructure/health.endpoint.ts';

export default handle(health, async () => success({ up: true }));
