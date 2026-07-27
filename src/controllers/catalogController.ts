import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { DEFAULT_LANGUAGE } from '../services/foodService';
import { getTagLabelsByCode } from '../services/labelService';

// Translated display labels for the fixed tag codes a dish's `tags` object
// carries (allergens, dietaryRestrictions, intolerances, features, diets),
// keyed by the same UPPER_SNAKE codes the feed/food endpoints return — so a
// client renders a tag by looking up `labels.allergens[code]` directly.
export const getLabels = asyncHandler(async (req: Request, res: Response) => {
  const lang = (req.query.lang as unknown as string | undefined) ?? DEFAULT_LANGUAGE;
  res.status(200).json(getTagLabelsByCode(lang));
});
