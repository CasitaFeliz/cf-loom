import { admit, handle } from '@cf-loom/handlers';
import { apiKey } from '@org/definitions';

export default handle(apiKey, () => admit(apiKey, { callerId: 'orders-service' }));
