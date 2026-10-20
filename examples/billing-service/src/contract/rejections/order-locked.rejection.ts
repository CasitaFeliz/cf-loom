import { defineRejection } from '@casitafeliz/loom-contract';
import { z } from 'zod';

export const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order is locked and cannot be billed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});
