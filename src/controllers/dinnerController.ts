import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as dinnerService from '../services/dinnerService';
import { listIngredients } from '../services/ingredientService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import type { DinnerQuery } from '../validation/householdSchemas';

/** The user-facing ingredient search returns fewer rows than the admin picker. */
const INGREDIENT_SEARCH_LIMIT = 50;

// GET /dinner/suggestions — dishes that suit everyone at the table (see dinnerService).
export const getSuggestions = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as DinnerQuery;
  const result = await dinnerService.getDinnerSuggestions(req.auth!.userId, query);
  res.status(200).json(result);
});

// GET /ingredients?search=&lang= — the catalog, for the "what's at home" picker.
export const searchIngredients = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const ingredients = await listIngredients(
    req.query.search as unknown as string | undefined,
    req.query.lang as unknown as string | undefined,
  );
  res.status(200).json({
    ingredients: ingredients
      .slice(0, INGREDIENT_SEARCH_LIMIT)
      .map(({ id, name }) => ({ id, name })),
  });
});
