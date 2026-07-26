import { Router } from 'express';
import * as foodController from '../controllers/foodController';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import {
  feedQuerySchema,
  foodDetailQuerySchema,
  foodIdParamSchema,
  listInteractionsQuerySchema,
  recordInteractionSchema,
} from '../validation/foodSchemas';

export const foodRouter = Router();

// Every food route is authenticated so the feed and swipe history are scoped to the
// caller. Literal paths (/feed, /interactions) are declared BEFORE the /:foodId
// param route so Express never mistakes "feed"/"interactions" for a food id.

// The Tinder-style recommendation deck: dishes the user hasn't swiped yet, paginated.
foodRouter.get('/feed', requireAuth, validateQuery(feedQuerySchema), foodController.getFeed);

// The user's own swipe history ("my likes / dislikes"), optionally filtered by action.
foodRouter.get(
  '/interactions',
  requireAuth,
  validateQuery(listInteractionsQuerySchema),
  foodController.listMyInteractions,
);

// Full detail for one dish.
foodRouter.get(
  '/:foodId',
  requireAuth,
  validateParams(foodIdParamSchema),
  validateQuery(foodDetailQuerySchema),
  foodController.getFood,
);

// Record / overwrite a swipe (LIKE, SKIP, or DISLIKE + reason), and undo one.
foodRouter.post(
  '/:foodId/interactions',
  requireAuth,
  validateParams(foodIdParamSchema),
  validateBody(recordInteractionSchema),
  foodController.recordInteraction,
);
foodRouter.delete(
  '/:foodId/interactions',
  requireAuth,
  validateParams(foodIdParamSchema),
  foodController.deleteInteraction,
);
