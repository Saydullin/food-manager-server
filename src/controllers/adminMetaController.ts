import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { listCuisines } from '../services/cuisineService';
import { listDiets } from '../services/dietService';
import { getTagLabels } from '../services/labelService';
import {
  ALLERGEN_KEYS,
  DEFAULT_LANGUAGE,
  DIET_KEYS,
  FEATURE_KEYS,
  INTOLERANCE_KEYS,
  RESTRICTION_KEYS,
  SUPPORTED_LANGUAGES,
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
    languages: SUPPORTED_LANGUAGES,
  });
});

// Translated display labels for the fixed tag checkboxes, kept separate from
// food-form-options so switching the form's authoring language only re-fetches
// this (cheap, static) lookup instead of the DB-backed cuisine/diet catalogs.
export const getLabels = asyncHandler(async (req: Request, res: Response) => {
  const lang = (req.query.lang as unknown as string | undefined) ?? DEFAULT_LANGUAGE;
  res.status(200).json(getTagLabels(lang));
});
