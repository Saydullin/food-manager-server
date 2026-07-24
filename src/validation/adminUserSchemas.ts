import { z } from 'zod';

export const userIdParamSchema = z.object({
  userId: z.string().uuid('userId must be a UUID'),
});

export const listUsersQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(512).optional(),
});
