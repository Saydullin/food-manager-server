import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as foodService from '../services/foodService';
import * as recommendationService from '../services/recommendationService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

// GET /foods/feed — a page of the deck: unswiped dishes that fit the user's declared
// diets/exclusions, ranked by taste fit, keyset-paginated by (score, createdAt, id).
export const getFeed = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const page = await recommendationService.getFeed(req.auth!.userId, {
    limit: req.query.limit as unknown as number,
    cursor: req.query.cursor as unknown as string | undefined,
    lang: req.query.lang as unknown as string | undefined,
  });
  res.status(200).json(page);
});

// GET /foods/interactions — the user's own swipe history, optionally filtered by action.
export const listMyInteractions = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const page = await foodService.listInteractions(req.auth!.userId, {
    action: req.query.action as unknown as foodService.ListInteractionsParams['action'],
    limit: req.query.limit as unknown as number,
    cursor: req.query.cursor as unknown as string | undefined,
    lang: req.query.lang as unknown as string | undefined,
  });
  res.status(200).json(page);
});

// GET /foods/:foodId — full detail for a single dish.
export const getFood = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const food = await foodService.getFood(req.params.foodId, req.query.lang as unknown as string | undefined);
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
