import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as foodService from '../services/foodService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

// GET /foods/feed — a keyset-paginated page of the swipe deck (dishes not yet swiped).
export const getFeed = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const page = await foodService.getFeed(req.auth!.userId, {
    limit: req.query.limit as unknown as number,
    cursor: req.query.cursor as unknown as string | undefined,
  });
  res.status(200).json(page);
});

// GET /foods/interactions — the user's own swipe history, optionally filtered by action.
export const listMyInteractions = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const page = await foodService.listInteractions(req.auth!.userId, {
    action: req.query.action as unknown as foodService.ListInteractionsParams['action'],
    limit: req.query.limit as unknown as number,
    cursor: req.query.cursor as unknown as string | undefined,
  });
  res.status(200).json(page);
});

// GET /foods/:foodId — full detail for a single dish.
export const getFood = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const food = await foodService.getFood(req.params.foodId);
  res.status(200).json({ food });
});

// POST /foods/:foodId/interactions — record (or overwrite) the swipe verdict on a dish.
export const recordInteraction = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const interaction = await foodService.recordInteraction(
    req.auth!.userId,
    req.params.foodId,
    req.body,
  );
  res.status(200).json({ interaction });
});

// DELETE /foods/:foodId/interactions — undo a swipe (rewind); the dish re-enters the feed.
export const deleteInteraction = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await foodService.deleteInteraction(req.auth!.userId, req.params.foodId);
  res.status(200).json(result);
});
