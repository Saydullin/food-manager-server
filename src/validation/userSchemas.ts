import { z } from 'zod';

// A profile image is referenced by URL (the file itself lives in external storage,
// same convention as Food.imageUrl). Restricted to http(s) so we never store
// javascript:/data: URIs that a client might blindly render.
const imageUrl = z
  .string()
  .trim()
  .max(2048, 'imageUrl must be at most 2048 characters')
  .url('imageUrl must be a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), { message: 'imageUrl must be an http(s) URL' });

export const setProfileImageSchema = z.object({
  imageUrl,
});

// A single free-form food tag (a preference like "spicy"/"italian" or an
// exception like "cilantro"). Normalized to trimmed + lowercase so the list
// dedupes case-insensitively and matches the DB unique constraint on (userId, value).
const foodTag = z
  .string()
  .trim()
  .min(1, 'each entry must be a non-empty string')
  .max(100, 'each entry must be at most 100 characters')
  .toLowerCase();

// A list of food tags. Bounded in length, and de-duplicated after normalization
// so ["Spicy", "spicy", " spicy "] collapses to ["spicy"]. An empty array is
// allowed and means "clear the list".
const foodTagList = z
  .array(foodTag)
  .max(100, 'at most 100 entries are allowed')
  .transform((tags) => Array.from(new Set(tags)));

export const setFoodPreferencesSchema = z.object({
  preferences: foodTagList,
});

export const setFoodExceptionsSchema = z.object({
  exceptions: foodTagList,
});

// A BCP-47 language tag the client renders in (e.g. "en", "ru", "en-US"). Kept
// permissive (a primary subtag plus optional region/variant subtags) rather than
// pinned to a fixed list, since the client owns the set of supported locales.
const language = z
  .string()
  .trim()
  .max(35, 'language must be at most 35 characters')
  .regex(
    /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/,
    'language must be a BCP-47 language tag (e.g. "en", "en-US")',
  );

// The fixed set of UI themes. Mirrors the Theme enum in schema.prisma.
const theme = z.enum(['LIGHT', 'DARK', 'SYSTEM']);

// Partial update of the user's settings: every field is optional, but at least one
// must be present so an empty body is a clear 400 rather than a silent no-op.
// `.strict()` rejects unknown keys, catching client-side typos (e.g. a misspelled
// "pushNotification") instead of silently ignoring them.
export const updateSettingsSchema = z
  .object({
    language: language.optional(),
    theme: theme.optional(),
    pushNotificationsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'provide at least one of: language, theme, pushNotificationsEnabled',
  });
