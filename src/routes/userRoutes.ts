import { Router } from 'express';
import * as userController from '../controllers/userController';
import * as dietController from '../controllers/dietController';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody } from '../middleware/validate';
import {
  setFoodExceptionsSchema,
  setFoodPreferencesSchema,
  setProfileImageSchema,
} from '../validation/userSchemas';
import { setDietsSchema } from '../validation/dietSchemas';

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

// Food preferences / exceptions: each is a free-form list of strings, replaced in
// full by a single idempotent PUT. Both require a valid access token (requireAuth),
// so the list always belongs to the authenticated user.
userRouter.put(
  '/me/food-preferences',
  requireAuth,
  validateBody(setFoodPreferencesSchema),
  userController.setFoodPreferences,
);
userRouter.put(
  '/me/food-exceptions',
  requireAuth,
  validateBody(setFoodExceptionsSchema),
  userController.setFoodExceptions,
);

// Selected diets: the client sends the fixed catalog's enum codes (see GET /diets),
// replaced in full by a single idempotent PUT. Requires a valid access token.
userRouter.put(
  '/me/diets',
  requireAuth,
  validateBody(setDietsSchema),
  dietController.setMyDiets,
);
