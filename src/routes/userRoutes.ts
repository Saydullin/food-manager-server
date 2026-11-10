import { Router } from 'express';
import * as userController from '../controllers/userController';
import * as dietController from '../controllers/dietController';
import * as householdController from '../controllers/householdController';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import {
  eaterIdParamSchema,
  pantryQuerySchema,
  putEaterSchema,
  putKitchenSchema,
  putPantrySchema,
} from '../validation/householdSchemas';
import {
  setFoodExceptionsSchema,
  setFoodPreferencesSchema,
  setProfileImageSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '../validation/userSchemas';
import { setDietsSchema } from '../validation/dietSchemas';

export const userRouter = Router();

userRouter.get('/me', requireAuth, userController.getMe);

// Edit the account's profile fields (username, name, age, status, description).
// PATCH = partial update: only the fields sent are changed. Requires a valid token.
userRouter.patch(
  '/me',
  requireAuth,
  validateBody(updateProfileSchema),
  userController.updateMyProfile,
);

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

// Marks the account as having answered (or declined) the onboarding questions, so the
// app asks exactly once per user rather than once per install. Takes no body and is
// idempotent; POST rather than a PATCH field because it's a one-way latch.
userRouter.post('/me/onboarding-complete', requireAuth, userController.completeOnboarding);

// Client-side settings (language, theme, push notifications). GET reads the current
// set (available right after registration/login); PATCH applies a partial update —
// only the fields sent are changed. Both require a valid access token.
userRouter.get('/me/settings', requireAuth, userController.getMySettings);
userRouter.patch(
  '/me/settings',
  requireAuth,
  validateBody(updateSettingsSchema),
  userController.updateMySettings,
);

// --- "Cook dinner": household, kitchen, pantry -------------------------------
// All replace-in-full PUTs, so the client can replay them from an offline queue.

// The people the user cooks for. Eater ids are client-generated UUIDs (see schema).
userRouter.get('/me/household/eaters', requireAuth, householdController.listEaters);
userRouter.put(
  '/me/household/eaters/:eaterId',
  requireAuth,
  validateParams(eaterIdParamSchema),
  validateBody(putEaterSchema),
  householdController.putEater,
);
userRouter.delete(
  '/me/household/eaters/:eaterId',
  requireAuth,
  validateParams(eaterIdParamSchema),
  householdController.deleteEater,
);

// Kitchen equipment. `appliances: null` on GET = never asked.
userRouter.get('/me/kitchen', requireAuth, householdController.getKitchen);
userRouter.put('/me/kitchen', requireAuth, validateBody(putKitchenSchema), householdController.putKitchen);

// What's at home, as catalog ingredient ids (see GET /ingredients).
userRouter.get('/me/pantry', requireAuth, validateQuery(pantryQuerySchema), householdController.getPantry);
userRouter.put(
  '/me/pantry',
  requireAuth,
  validateQuery(pantryQuerySchema),
  validateBody(putPantrySchema),
  householdController.putPantry,
);
