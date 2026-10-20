import { admit, handle, reject } from '@casitafeliz/loom-handlers';
import { clientIdOf } from '../api-keys/api-keys.ts';
import { apiKey } from '../contract/guards/api-key.guard.ts';
import { unauthenticated } from '../contract/rejections/unauthenticated.rejection.ts';

export default handle(apiKey, async ({ headers }) => {
  const clientId = clientIdOf(headers['x-api-key']);
  if (clientId === undefined) return reject(unauthenticated);
  return admit({ clientId });
});
