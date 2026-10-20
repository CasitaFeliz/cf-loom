import { openEnum } from '@cf-loom/contract';
import { money } from '@org/definitions';
import { z } from 'zod';

export const order = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  status: openEnum(['pending', 'paid', 'shipped', 'cancelled']),
  total: money,
  placedAt: z.iso.datetime(),
});
