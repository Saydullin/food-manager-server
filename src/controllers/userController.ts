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
