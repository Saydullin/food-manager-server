import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as dietService from '../services/dietService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

// Returns the fixed, server-owned catalog of diet enum codes the client can pick from.
export const listDiets = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const diets = await dietService.listDiets();
  res.status(200).json({ diets });
});

// Replaces the authenticated user's selected diets with the posted enum codes.
export const setMyDiets = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await dietService.setUserDiets(req.auth!.userId, req.body.diets);
  res.status(200).json({ user });
});
