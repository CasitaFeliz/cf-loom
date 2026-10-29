import { admit, handle, reject } from '@cf-loom/handlers';
import { apiKey, unauthenticated } from '@org/definitions';
import { callerIdOf } from '../api-keys/api-keys.ts';

const challenge = 'ApiKey realm="orders-service"';

export default handle(apiKey, async ({ headers }) => {
  const callerId = callerIdOf(headers['x-api-key']);
  if (callerId === undefined)
    return reject(unauthenticated, { headers: { 'www-authenticate': challenge } });
  return admit(apiKey, { callerId });
});
