import { defineGuard } from '@casitafeliz/loom-contract';
import { z } from 'zod';
import { unauthenticated } from '../rejections/unauthenticated.rejection.ts';

export const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: {
    headers: z.object({ 'x-api-key': z.string() }),
  },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});
