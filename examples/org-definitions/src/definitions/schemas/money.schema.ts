import { z } from 'zod';

export const money = z.object({
  amount: z.int().nonnegative().describe('In minor units, such as cents'),
  currency: z.string().length(3).describe('An ISO 4217 code'),
});
