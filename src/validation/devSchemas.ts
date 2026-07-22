import { z } from 'zod';

export const signSchema = z.object({
  privateKey: z.string().min(1),
  message: z.string().min(1),
});
