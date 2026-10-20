import { admit, handle, reject } from '@cf-loom/handlers';
import { callerIdOf } from '../api-keys/api-keys.ts';
import { apiKey } from '../contract/guards/api-key.guard.ts';
import { unauthenticated } from '../contract/rejections/unauthenticated.rejection.ts';

export default handle(apiKey, async ({ headers }) => {
  const callerId = callerIdOf(headers['x-api-key']);
  if (callerId === undefined) return reject(unauthenticated);
  return admit({ callerId });
});
