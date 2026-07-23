import { z } from 'zod';

// A dish id in the URL path. UUID so a bad id is a clean 400 rather than reaching
// the DB (and so literal routes like /foods/feed are never mistaken for an id).
export const foodIdParamSchema = z.object({
  foodId: z.string().uuid('foodId must be a UUID'),
});

// Feed page size. Coerced from the query string; bounded so a client can't ask for
// an unbounded page. Defaults to a Tinder-ish small deck.
const limit = z.coerce
  .number()
  .int('limit must be an integer')
  .min(1, 'limit must be at least 1')
  .max(50, 'limit must be at most 50')
  .default(10);

// An opaque keyset cursor (see utils/cursor). Validated for shape here; decoded in
// the service. Optional — absent means "start from the top".
const cursor = z.string().trim().min(1).max(512).optional();

export const feedQuerySchema = z.object({
  limit,
  cursor,
});

// The three swipe verdicts, mirroring the FoodInteractionAction enum in schema.prisma.
const action = z.enum(['LIKE', 'SKIP', 'DISLIKE']);

// Why a dish was disliked, mirroring the FoodDislikeReason enum. Only meaningful
// for a DISLIKE (enforced by the refinement below).
const reason = z.enum([
  'DISLIKE_TAG',
  'WRONG_CUISINE',
  'ALREADY_ATE',
  'ALLERGEN',
  'NOT_IN_MOOD',
  'OTHER',
]);

// The specific tag/cuisine code behind a DISLIKE_TAG / WRONG_CUISINE (e.g. "SPICY",
// "MILK", "ITALIAN"). Free-form UPPER_SNAKE-ish; the client already knows the codes.
const reasonDetail = z
  .string()
  .trim()
  .min(1, 'reasonDetail must be a non-empty string')
  .max(64, 'reasonDetail must be at most 64 characters')
  .optional();

/**
 * Body for recording a swipe. `reason`/`reasonDetail` are only allowed on a DISLIKE
 * ("Hate it → why"); sending them with a LIKE/SKIP is a 400 so the stored signal
 * stays clean. When the reason is DISLIKE_TAG or WRONG_CUISINE, `reasonDetail` is
 * required (which tag / which cuisine); other reasons stand alone.
 */
export const recordInteractionSchema = z
  .object({
    action,
    reason: reason.optional(),
    reasonDetail,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.action !== 'DISLIKE') {
      if (body.reason !== undefined || body.reasonDetail !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'reason/reasonDetail are only allowed when action is DISLIKE',
        });
      }
      return;
    }
    if ((body.reason === 'DISLIKE_TAG' || body.reason === 'WRONG_CUISINE') && !body.reasonDetail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `reasonDetail is required when reason is ${body.reason}`,
        path: ['reasonDetail'],
      });
    }
  });

// Listing the user's own interactions ("my likes/dislikes"). Optional `action`
// filter; same cursor pagination as the feed.
export const listInteractionsQuerySchema = z.object({
  action: action.optional(),
  limit,
  cursor,
});
