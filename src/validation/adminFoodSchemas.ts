import { z } from 'zod';
import {
  ALLERGEN_KEYS,
  DIET_KEYS,
  FEATURE_KEYS,
  INTOLERANCE_KEYS,
  RESTRICTION_KEYS,
} from '../services/foodService';

export const foodIdParamSchema = z.object({
  foodId: z.string().uuid('foodId must be a UUID'),
});

const keyArray = (keys: string[]) =>
  z
    .array(z.enum(keys as [string, ...string[]]))
    .max(keys.length)
    .optional();

const nutritionSchema = z
  .object({
    calories: z.number().int().nonnegative().nullable().optional(),
    servings: z.number().int().positive().nullable().optional(),
    protein: z.number().nonnegative().nullable().optional(),
    fat: z.number().nonnegative().nullable().optional(),
    carbs: z.number().nonnegative().nullable().optional(),
  })
  .strict()
  .optional();

// A dish payload as authored from the admin panel. `images` is the ordered
// gallery (1..7 URLs, first doubles as cover) — mirrors the FoodImage.position
// contract already used by the mobile-facing read side in foodService.ts.
export const foodPayloadSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    cuisineCode: z.string().trim().min(1).nullable().optional(),
    images: z.array(z.string().url()).max(7, 'a dish may have at most 7 images').optional(),
    nutrition: nutritionSchema,
    allergens: keyArray(ALLERGEN_KEYS),
    dietaryRestrictions: keyArray(RESTRICTION_KEYS),
    intolerances: keyArray(INTOLERANCE_KEYS),
    features: keyArray(FEATURE_KEYS),
    diets: keyArray(DIET_KEYS),
  })
  .strict();

export const createFoodSchema = foodPayloadSchema;

// A partial update: every field optional, but at least one must be present.
export const updateFoodSchema = foodPayloadSchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: 'At least one field must be provided' },
);

export const listFoodsQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(512).optional(),
});
