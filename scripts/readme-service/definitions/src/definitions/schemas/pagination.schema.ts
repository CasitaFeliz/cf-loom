export const pagination = z.object({ limit: z.int(), cursor: z.string().optional() });
