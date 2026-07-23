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
