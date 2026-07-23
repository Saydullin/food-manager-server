import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as cuisineService from '../services/cuisineService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

// Returns the fixed, server-owned catalog of cuisine enum codes the client can pick from.
export const listCuisines = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const cuisines = await cuisineService.listCuisines();
  res.status(200).json({ cuisines });
});
