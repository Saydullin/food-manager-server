import { z } from 'zod';

// A diet code is a machine-readable enum the client sends back (e.g. "VEGETARIAN").
// We only validate the SHAPE here (uppercase A–Z, digits, underscores) — whether a
// given code actually exists is checked against the diet catalog in the service,
// since the set of valid diets is data (admin-extensible), not a compile-time enum.
const dietCode = z
  .string()
  .trim()
  .min(1, 'each diet code must be a non-empty string')
  .max(64, 'each diet code must be at most 64 characters')
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]*$/, 'each diet code must be UPPER_SNAKE_CASE');

// The list of selected diet codes. De-duplicated; an empty array clears the
// user's selection.
const dietCodeList = z
  .array(dietCode)
  .max(100, 'at most 100 diets are allowed')
  .transform((codes) => Array.from(new Set(codes)));

export const setDietsSchema = z.object({
  diets: dietCodeList,
});
