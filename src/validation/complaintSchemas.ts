import { z } from 'zod';

const targetType = z.enum(['USER', 'FOOD']);

// Which target field is required is decided by targetType — mirrors the
// DISLIKE_TAG/WRONG_CUISINE reasonDetail refinement in foodSchemas.ts.
export const fileComplaintSchema = z
  .object({
    targetType,
    targetUserId: z.string().uuid().optional(),
    targetFoodId: z.string().uuid().optional(),
    reason: z.string().trim().min(1, 'reason is required').max(1000),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.targetType === 'USER' && !body.targetUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'targetUserId is required when targetType is USER',
        path: ['targetUserId'],
      });
    }
    if (body.targetType === 'FOOD' && !body.targetFoodId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'targetFoodId is required when targetType is FOOD',
        path: ['targetFoodId'],
      });
    }
    if (body.targetType === 'USER' && body.targetFoodId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'targetFoodId must not be set when targetType is USER',
        path: ['targetFoodId'],
      });
    }
    if (body.targetType === 'FOOD' && body.targetUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'targetUserId must not be set when targetType is FOOD',
        path: ['targetUserId'],
      });
    }
  });

export const complaintIdParamSchema = z.object({
  complaintId: z.string().uuid('complaintId must be a UUID'),
});

export const listComplaintsQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(512).optional(),
});

export const resolveComplaintSchema = z
  .object({
    status: z.enum(['RESOLVED', 'DISMISSED']),
  })
  .strict();
