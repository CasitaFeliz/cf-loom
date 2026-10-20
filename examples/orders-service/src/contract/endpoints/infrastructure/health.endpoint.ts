import { defineEndpoint } from '@casitafeliz/loom-contract';
import { z } from 'zod';

export const health = defineEndpoint({
  name: 'health',
  method: 'GET',
  path: '/health',
  visibility: 'private',
  description: 'Whether the Service is up, for its infrastructure',
  success: { status: 200, body: z.object({ up: z.boolean() }) },
});
