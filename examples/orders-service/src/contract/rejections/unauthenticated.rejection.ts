import { defineRejection } from '@casitafeliz/loom-contract';

export const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'The API key is unknown',
});
