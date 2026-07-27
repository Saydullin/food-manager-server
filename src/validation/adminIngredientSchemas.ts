import { z } from 'zod';

// A BCP-47-ish language tag, e.g. "en", "ru", "en-US" — same leniency as
// adminFoodSchemas's `language`, so the admin panel isn't limited to a fixed enum.
const language = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/, 'language must be a BCP-47 tag, e.g. "en" or "en-US"')
  .transform((s) => s.toLowerCase());

export const listIngredientsQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  lang: language.optional(),
});

export const createIngredientSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
    language: language.optional(),
  })
  .strict();

export const ingredientIdParamSchema = z.object({
  id: z.string().uuid('id must be a UUID'),
});

export const addIngredientTranslationSchema = z
  .object({
    language,
    name: z.string().trim().min(1, 'name is required').max(200),
  })
  .strict();
