import { Router } from 'express';
import * as userController from '../controllers/userController';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody } from '../middleware/validate';
import { setProfileImageSchema } from '../validation/userSchemas';

export const userRouter = Router();

userRouter.get('/me', requireAuth, userController.getMe);

// PUT = set/change (idempotent), DELETE = remove — a REST sub-resource for the picture.
userRouter.put(
  '/me/image',
  requireAuth,
  validateBody(setProfileImageSchema),
  userController.setProfileImage,
);
userRouter.delete('/me/image', requireAuth, userController.removeProfileImage);
