import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { listCuisines } from '../services/cuisineService';
import { listDiets } from '../services/dietService';
import {
  ALLERGEN_KEYS,
  DIET_KEYS,
  FEATURE_KEYS,
  INTOLERANCE_KEYS,
  RESTRICTION_KEYS,
} from '../services/foodService';

// The catalogs + fixed tag-code lists the admin recipe form needs to render its
// dropdowns/checkboxes, in one round-trip.
export const getFoodFormOptions = asyncHandler(async (_req: Request, res: Response) => {
  const [cuisines, diets] = await Promise.all([listCuisines(), listDiets()]);
  res.status(200).json({
    cuisines,
    diets,
    allergens: ALLERGEN_KEYS,
    dietaryRestrictions: RESTRICTION_KEYS,
    intolerances: INTOLERANCE_KEYS,
    features: FEATURE_KEYS,
    foodDiets: DIET_KEYS,
  });
});
