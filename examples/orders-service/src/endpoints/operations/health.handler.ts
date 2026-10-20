import { handle, success } from '@casitafeliz/loom-handlers';
import { health } from '../../contract/endpoints/operations/health.endpoint.ts';

export default handle(health, async () => success({ up: true }));
