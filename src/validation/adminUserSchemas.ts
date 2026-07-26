import { z } from 'zod';

export const userIdParamSchema = z.object({
  userId: z.string().uuid('userId must be a UUID'),
});

export const listUsersQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

export const updateUserStatusSchema = z.object({
  status: z.string().trim().min(1).max(150).nullable(),
});
