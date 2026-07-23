import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as userService from '../services/userService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

export const getMe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await userService.getProfile(req.auth!.userId);
  res.status(200).json({ user });
});

export const setProfileImage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await userService.setProfileImage(req.auth!.userId, req.body.imageUrl);
  res.status(200).json({ user });
});

export const removeProfileImage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await userService.removeProfileImage(req.auth!.userId);
  res.status(200).json({ user });
});

export const setFoodPreferences = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await userService.setFoodPreferences(req.auth!.userId, req.body.preferences);
    res.status(200).json({ user });
  },
);

export const setFoodExceptions = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await userService.setFoodExceptions(req.auth!.userId, req.body.exceptions);
  res.status(200).json({ user });
});
