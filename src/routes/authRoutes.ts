import { Router } from 'express';
import * as authController from '../controllers/authController';
import * as deviceController from '../controllers/deviceController';
import { requireAuth } from '../middleware/requireAuth';
import { emailCodeRateLimiter, loginRateLimiter, recoveryRateLimiter } from '../middleware/rateLimit';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  challengeSchema,
  deviceAddSchema,
  emailAddSchema,
  emailVerifyCodeSchema,
  emailVerifyQuerySchema,
  logoutSchema,
  recoveryConfirmSchema,
  recoveryRequestSchema,
  refreshSchema,
  registerSchema,
  usernameAvailabilitySchema,
  verifySchema,
} from '../validation/authSchemas';

export const authRouter = Router();

authRouter.get(
  '/username-available',
  validateQuery(usernameAvailabilitySchema),
  authController.checkUsernameAvailability,
);
authRouter.post('/register', validateBody(registerSchema), authController.register);
authRouter.post('/challenge', loginRateLimiter, validateBody(challengeSchema), authController.challenge);
authRouter.post('/verify', loginRateLimiter, validateBody(verifySchema), authController.verify);
authRouter.post('/refresh', validateBody(refreshSchema), authController.refresh);
authRouter.post('/logout', validateBody(logoutSchema), authController.logout);

authRouter.post('/email/add', requireAuth, validateBody(emailAddSchema), authController.addEmail);
authRouter.get('/email/verify', validateQuery(emailVerifyQuerySchema), authController.verifyEmail);
authRouter.post(
  '/email/verify-code',
  requireAuth,
  emailCodeRateLimiter,
  validateBody(emailVerifyCodeSchema),
  authController.verifyEmailCode,
);

authRouter.post(
  '/recovery/request',
  recoveryRateLimiter,
  validateBody(recoveryRequestSchema),
  authController.requestRecovery,
);
authRouter.post('/recovery/confirm', validateBody(recoveryConfirmSchema), authController.confirmRecovery);

authRouter.post('/devices/add', requireAuth, validateBody(deviceAddSchema), deviceController.addDevice);
authRouter.get('/devices', requireAuth, deviceController.listDevices);
authRouter.delete('/devices/:deviceId', requireAuth, deviceController.revokeDevice);
