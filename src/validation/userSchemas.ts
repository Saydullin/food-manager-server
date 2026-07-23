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
