import { admit, handle, reject } from '@cf-loom/handlers';
import { apiKey, unauthenticated } from '@org/definitions';
import { callerIdOf } from '../api-keys/api-keys.ts';

export default handle(apiKey, async ({ headers }) => {
  const callerId = callerIdOf(headers['x-api-key']);
  if (callerId === undefined) return reject(unauthenticated);
  return admit({ callerId });
});
