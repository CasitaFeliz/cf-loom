import { defineRejection } from '@cf-loom/contract';

export const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'The API key is missing or unknown',
});
