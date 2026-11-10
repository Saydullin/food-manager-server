import { Router } from 'express';
import * as dinnerController from '../controllers/dinnerController';
import { requireAuth } from '../middleware/requireAuth';
import { validateQuery } from '../middleware/validate';
import { dinnerQuerySchema, ingredientSearchQuerySchema } from '../validation/householdSchemas';

export const dinnerRouter = Router();

// Dishes that suit every selected eater, the kitchen, and optionally the pantry.
dinnerRouter.get(
  '/suggestions',
  requireAuth,
  validateQuery(dinnerQuerySchema),
  dinnerController.getSuggestions,
);

export const ingredientRouter = Router();

// The ingredient catalog for the "what's at home" picker. Read-only for users —
// adding to the catalog stays an admin action (/admin/ingredients).
ingredientRouter.get(
  '/',
  requireAuth,
  validateQuery(ingredientSearchQuerySchema),
  dinnerController.searchIngredients,
);
