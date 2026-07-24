import { Router } from 'express';
import * as adminAuthController from '../../controllers/adminAuthController';
import { adminLoginRateLimiter } from '../../middleware/rateLimit';
import { validateBody } from '../../middleware/validate';
import { adminLoginSchema } from '../../validation/adminAuthSchemas';

export const adminAuthRouter = Router();

adminAuthRouter.post(
  '/login',
  adminLoginRateLimiter,
  validateBody(adminLoginSchema),
  adminAuthController.login,
);
