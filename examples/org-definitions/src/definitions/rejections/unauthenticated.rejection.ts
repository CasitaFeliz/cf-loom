import { defineRejection } from '@cf-loom/contract';
import { z } from 'zod';

export const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'The API key is missing or unknown',
  headers: z.object({ 'www-authenticate': z.string().describe('How to present an API key') }),
});
