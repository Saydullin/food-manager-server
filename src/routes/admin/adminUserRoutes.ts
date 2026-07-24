import { Router } from 'express';
import * as adminUserController from '../../controllers/adminUserController';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validateParams, validateQuery } from '../../middleware/validate';
import { listUsersQuerySchema, userIdParamSchema } from '../../validation/adminUserSchemas';

export const adminUserRouter = Router();

adminUserRouter.get('/', requireAdmin, validateQuery(listUsersQuerySchema), adminUserController.listUsers);
adminUserRouter.get(
  '/:userId',
  requireAdmin,
  validateParams(userIdParamSchema),
  adminUserController.getUserDetail,
);
adminUserRouter.post(
  '/:userId/ban',
  requireAdmin,
  validateParams(userIdParamSchema),
  adminUserController.banUser,
);
adminUserRouter.post(
  '/:userId/unban',
  requireAdmin,
  validateParams(userIdParamSchema),
  adminUserController.unbanUser,
);
