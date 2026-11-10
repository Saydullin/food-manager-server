import { z } from 'zod';
import { ALLERGEN_KEYS, toTagCode } from '../utils/tagVocabulary';
import { lang } from './foodSchemas';

// ---------------------------------------------------------------------------
// Shared vocabularies (also used by PATCH /users/me for the account owner)
// ---------------------------------------------------------------------------

/** Mirrors the Sex enum in schema.prisma. */
export const sex = z.enum(['MALE', 'FEMALE']);

/** Mirrors the MedicalRestriction enum in schema.prisma. */
const medicalRestriction = z.enum([
  'LOW_CALORIE',
  'LOW_FAT',
  'LOW_CARB',
  'NO_SPICY',
  'LOW_SALT',
  'LOW_SUGAR',
]);

/** Mirrors the KitchenAppliance enum in schema.prisma. */
const appliance = z.enum([
  'STOVE',
  'OVEN',
  'AIR_FRYER',
  'MICROWAVE',
  'GRILL',
  'MULTICOOKER',
  'BLENDER',
]);

const dedupe = <T>(values: T[]): T[] => Array.from(new Set(values));

/** A whole-list replacement; [] clears it. */
export const medicalRestrictionList = z.array(medicalRestriction).max(20).transform(dedupe);

const applianceList = z.array(appliance).max(20).transform(dedupe);

// Allergens are a closed, code-level set (the FoodAllergens columns), so they're
// validated here rather than against the DB. Uppercased first so "peanuts" works too.
const ALLERGEN_CODES = ALLERGEN_KEYS.map(toTagCode) as [string, ...string[]];
const allergenCode = z.string().trim().toUpperCase().pipe(z.enum(ALLERGEN_CODES));

// Diet codes are catalog data (admin-extensible), so only the shape is checked
// here; existence is checked against the `diets` table in the service — same split
// as PUT /users/me/diets.
const dietCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]*$/, 'each diet code must be UPPER_SNAKE_CASE')
  .max(64);

// A like / "won't eat" entry: a tag or cuisine code ("SPICY", "ITALIAN") or free text
// ("кинза"). Case is preserved — the client compares these against its own codes —
// and matching downstream is case-insensitive anyway.
const tasteEntry = z.string().trim().min(1, 'entries must be non-empty').max(100);
const tasteList = z.array(tasteEntry).max(50).transform(dedupe);

// ---------------------------------------------------------------------------
// Household eaters
// ---------------------------------------------------------------------------

export const eaterIdParamSchema = z.object({
  eaterId: z.string().uuid('eaterId must be a UUID'),
});

/**
 * A full eater, as PUT replaces it whole. Optional lists default to [] so a client
 * that omits a field clears it — PUT semantics, not PATCH.
 */
export const putEaterSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name is required')
      .max(50, 'name must be at most 50 characters'),
    sex: sex.nullable().default(null),
    age: z.number().int().min(0).max(150).nullable().default(null),
    likes: tasteList.default([]),
    avoid: tasteList.default([]),
    allergens: z.array(allergenCode).max(ALLERGEN_CODES.length).transform(dedupe).default([]),
    diets: z.array(dietCode).max(50).transform(dedupe).default([]),
    medicalRestrictions: medicalRestrictionList.default([]),
  })
  .strict();

export type PutEaterInput = z.infer<typeof putEaterSchema>;

// ---------------------------------------------------------------------------
// Kitchen & pantry
// ---------------------------------------------------------------------------

export const putKitchenSchema = z.object({ appliances: applianceList }).strict();

export const putPantrySchema = z
  .object({
    ingredientIds: z
      .array(z.string().uuid('ingredientIds must be UUIDs'))
      .max(500)
      .transform(dedupe),
  })
  .strict();

export const pantryQuerySchema = z.object({ lang });

export const ingredientSearchQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  lang,
});

// ---------------------------------------------------------------------------
// Dinner suggestions
// ---------------------------------------------------------------------------

// Query strings carry booleans as text; only the two literal spellings are accepted
// so a typo like "ture" is a 400 instead of silently meaning false.
const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

export const dinnerQuerySchema = z
  .object({
    // Comma-separated, e.g. ?eaterIds=a,b. Empty or absent = nobody but (maybe) me.
    eaterIds: z
      .string()
      .optional()
      .transform((raw) =>
        dedupe(
          (raw ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      )
      .pipe(z.array(z.string().uuid('eaterIds must be UUIDs')).max(20)),
    includeSelf: queryBoolean.default('true'),
    source: z.enum(['ANY', 'AT_HOME']).default('ANY'),
    maxMissing: z.coerce.number().int().min(0).max(10).default(2),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    lang,
  })
  .refine((q) => q.includeSelf || q.eaterIds.length > 0, {
    message: 'nobody is eating: pass eaterIds and/or includeSelf=true',
  });

export type DinnerQuery = z.infer<typeof dinnerQuerySchema>;
