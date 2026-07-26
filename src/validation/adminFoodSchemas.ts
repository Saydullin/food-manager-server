import { z } from 'zod';
import {
  ALLERGEN_KEYS,
  DEFAULT_LANGUAGE,
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

// A BCP-47-ish language tag, e.g. "en", "ru", "en-US" — same leniency as
// UserSettings.language, so the admin panel isn't limited to a fixed enum.
const language = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/, 'language must be a BCP-47 tag, e.g. "en" or "en-US"')
  .transform((s) => s.toLowerCase());

const translationSchema = z
  .object({
    language,
    name: z.string().trim().min(1, 'name is required').max(200),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

// At least one translation, and it must include the default language — every
// dish needs one language nothing else can silently fall back past.
const translationsSchema = z
  .array(translationSchema)
  .min(1, 'at least one translation is required')
  .superRefine((translations, ctx) => {
    const languages = translations.map((t) => t.language);
    if (new Set(languages).size !== languages.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate language in translations' });
    }
    if (!languages.includes(DEFAULT_LANGUAGE)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `translations must include the default language "${DEFAULT_LANGUAGE}"`,
      });
    }
  });

// A dish payload as authored from the admin panel. `images` is the ordered
// gallery (1..7 URLs, first doubles as cover) — mirrors the FoodImage.position
// contract already used by the mobile-facing read side in foodService.ts.
export const foodPayloadSchema = z
  .object({
    translations: translationsSchema,
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
// `translations`, when present, still needs >=1 entry including the default
// language (a PATCH replaces the whole translation set, same convention as
// `images`/tag arrays below).
export const updateFoodSchema = foodPayloadSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

export const listFoodsQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});
