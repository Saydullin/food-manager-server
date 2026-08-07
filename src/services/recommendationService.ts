/**
 * The personalized food feed.
 *
 * Replaces the original newest-first feed: dishes the user has not swiped are now
 * filtered for safety and diet compliance, then ordered by how well they fit that
 * user's taste. Every signal this uses was already being collected — declared
 * diets/exceptions/preferences on the account, and the like/skip/dislike verdicts
 * (with their dislike reasons) in `food_interactions` — none of it previously
 * influenced the feed at all.
 *
 * Ranking is deliberately done in application code rather than SQL, in two phases:
 *
 *  1. Fetch the *scoring-relevant* columns only (id, createdAt, cuisine, tag flags)
 *     for every unswiped candidate that passes the hard filters. No translations,
 *     images, ingredients or nutrition — so a wide candidate scan stays cheap.
 *  2. Score and sort them (see `recommendation/ranking`), slice out the requested
 *     page, then fetch the full dish shape for just that page's handful of ids.
 *
 * The alternative — a scoring expression in SQL — would need raw SQL and would put
 * the weights out of reach of unit tests, for no benefit at this catalog size.
 *
 * See {@link MAX_CANDIDATES} for the one scale limit this design carries.
 */

import { prisma } from '../config/prisma';
import { decodeRankCursor, encodeRankCursor } from '../utils/cursor';
import { DEFAULT_LANGUAGE, foodInclude, shapeFood, trueTags, type FoodView, type Page } from './foodService';
import { listCuisines } from './cuisineService';
import {
  buildDeclaredScoring,
  buildHardFilters,
  compareRank,
  emptySignals,
  rankCandidates,
  type Candidate,
  type TasteProfile,
  type TasteSignals,
} from './recommendation/ranking';

export interface FeedParams {
  limit: number;
  cursor?: string;
  lang?: string;
}

/**
 * How many unswiped dishes get scored per feed request.
 *
 * The ranking has to see a candidate to rank it, so this is also the depth of
 * catalog the feed can reach: with more than this many unswiped dishes, the newest
 * `MAX_CANDIDATES` are ranked and older ones aren't served until newer ones are
 * swiped away. Harmless at the current catalog size (tens of dishes) and generous
 * for the near term, but it is a real ceiling — crossing it is the signal to move
 * scoring into SQL rather than to raise this number. A crossing is logged, never
 * silent.
 */
const MAX_CANDIDATES = 1000;

/**
 * How many of the user's most recent verdicts inform the taste signal. Recent
 * verdicts describe current taste better than a years-old one, and this bounds the
 * per-request work for a heavy user.
 */
const MAX_INTERACTION_HISTORY = 300;

/** The dish columns needed to score a candidate — deliberately not `foodInclude`. */
const candidateSelect = {
  id: true,
  createdAt: true,
  cuisine: { select: { code: true } },
  features: true,
  diets: true,
  dietaryRestrictions: true,
} as const;

type CandidateRow = {
  id: string;
  createdAt: Date;
  cuisine: { code: string } | null;
  features: Record<string, unknown> | null;
  diets: Record<string, unknown> | null;
  dietaryRestrictions: Record<string, unknown> | null;
};

/**
 * Flattens the three *taste* tag tables into the codes a dish carries. Allergens and
 * intolerances are left out on purpose — they're handled by the hard filters, and
 * scoring a dish up for carrying an allergen would be nonsense.
 */
const toCandidate = (row: CandidateRow): Candidate => ({
  id: row.id,
  createdAt: row.createdAt,
  cuisine: row.cuisine?.code ?? null,
  tags: [...trueTags(row.features), ...trueTags(row.diets), ...trueTags(row.dietaryRestrictions)],
});

/**
 * The user's declared taste profile. A token whose user no longer exists yields an
 * empty profile (no filters) rather than a 404 — the feed never used to care whether
 * the account row was still there, and this endpoint isn't the right place to start
 * failing on it.
 */
const loadTasteProfile = async (userId: string): Promise<TasteProfile> => {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      foodPreferences: { select: { value: true } },
      foodExceptions: { select: { value: true } },
      diets: { select: { diet: { select: { code: true } } } },
    },
  });
  return {
    foodPreferences: row?.foodPreferences.map((p) => p.value) ?? [],
    foodExceptions: row?.foodExceptions.map((e) => e.value) ?? [],
    diets: row?.diets.map((d) => d.diet.code) ?? [],
  };
};

/**
 * Aggregates the user's own verdicts into the learned taste signal.
 *
 * Asymmetry worth noting: likes contribute both cuisine and tag affinity, but
 * dislikes only contribute *tags* when the user said which tag bothered them
 * (`DISLIKE_TAG` + `reasonDetail`). Inferring tag dislikes from a rejected dish
 * would blame all ~8 of its tags for one rejection, which is mostly noise. Cuisine
 * is single-valued, so inferring it from a rejection is sound enough to keep at a
 * low weight.
 */
const loadTasteSignals = async (userId: string): Promise<TasteSignals> => {
  const rows = await prisma.foodInteraction.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: MAX_INTERACTION_HISTORY,
    select: {
      action: true,
      reason: true,
      reasonDetail: true,
      food: { select: candidateSelect },
    },
  });
  if (!rows.length) return emptySignals();

  const bump = (map: Map<string, number>, key: string | null | undefined): void => {
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  };

  const likedCuisineCounts = new Map<string, number>();
  const likedTagCounts = new Map<string, number>();
  const explicitCuisineDislikes = new Map<string, number>();
  const explicitTagDislikes = new Map<string, number>();
  const implicitCuisineDislikes = new Map<string, number>();
  let likeCount = 0;

  for (const row of rows) {
    const candidate = toCandidate(row.food);

    if (row.action === 'LIKE') {
      likeCount += 1;
      bump(likedCuisineCounts, candidate.cuisine);
      for (const tag of candidate.tags) bump(likedTagCounts, tag);
      continue;
    }

    if (row.action === 'DISLIKE') {
      bump(implicitCuisineDislikes, candidate.cuisine);
      if (row.reason === 'WRONG_CUISINE') bump(explicitCuisineDislikes, row.reasonDetail);
      if (row.reason === 'DISLIKE_TAG') bump(explicitTagDislikes, row.reasonDetail);
    }
    // SKIP is intentionally unweighted: "not right now" is too weak to read as taste.
  }

  // Counts -> share of this user's likes, so score magnitudes don't grow with usage.
  const toShares = (counts: Map<string, number>): Map<string, number> =>
    likeCount === 0 ? new Map() : new Map([...counts].map(([key, n]) => [key, n / likeCount]));

  return {
    likedCuisines: toShares(likedCuisineCounts),
    likedTags: toShares(likedTagCounts),
    explicitCuisineDislikes,
    explicitTagDislikes,
    implicitCuisineDislikes,
    hasAnySignal: true,
  };
};

/**
 * A page of the deck: unswiped dishes that satisfy the user's declared diets and
 * exclusions, best fit first.
 *
 * Paging is keyset over `(score, createdAt, id)` — the same "resume strictly after
 * the last row served" contract the old feed had, just with fit as the leading key,
 * so no dish is skipped or repeated as the swiped set grows underneath it. One
 * inherent wrinkle of any personalized feed: a verdict recorded mid-deck changes
 * scores, so a dish can cross the cursor boundary and be missed or repeated on the
 * next page. Bounded and self-correcting — a cursor-less request always rebuilds a
 * correct top-of-deck, and re-recording a verdict is an upsert.
 */
export const getFeed = async (
  userId: string,
  { limit, cursor, lang = DEFAULT_LANGUAGE }: FeedParams,
): Promise<Page<FoodView>> => {
  const cursorKey = cursor ? decodeRankCursor(cursor) : null;

  const profile = await loadTasteProfile(userId);
  const { where: hardFilters, penalizedTags, unmappedDiets } = buildHardFilters(profile);
  if (unmappedDiets.length) {
    // A diet the catalog offers but no dish column can express — it constrains
    // nothing, so say so rather than let it look enforced.
    console.warn(
      `[feed] user ${userId}: diet code(s) not filterable, no dish flag maps to them: ${unmappedDiets.join(', ')}`,
    );
  }

  const [candidateRows, signals, cuisineCodes] = await Promise.all([
    prisma.food.findMany({
      where: { AND: [{ interactions: { none: { userId } } }, ...hardFilters] },
      select: candidateSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_CANDIDATES,
    }),
    loadTasteSignals(userId),
    listCuisines(),
  ]);
  if (candidateRows.length === MAX_CANDIDATES) {
    console.warn(
      `[feed] user ${userId}: candidate scan hit the ${MAX_CANDIDATES}-dish cap; ` +
        'older unswiped dishes are not being ranked — move scoring into SQL.',
    );
  }

  const declared = buildDeclaredScoring(profile, cuisineCodes, penalizedTags);
  const ranked = rankCandidates(candidateRows.map(toCandidate), signals, declared);

  // Everything ranked strictly after the cursor's key. Purely a comparison on key
  // values, so it still resolves correctly when the cursor's own dish has since been
  // swiped and dropped out of the candidate set.
  const start = cursorKey ? ranked.findIndex((candidate) => compareRank(candidate, cursorKey) > 0) : 0;
  const page = start === -1 ? [] : ranked.slice(start, start + limit);
  const hasMore = start !== -1 && start + page.length < ranked.length;

  // Phase 2: the full dish shape, for this page's ids only.
  const rows = page.length
    ? await prisma.food.findMany({ where: { id: { in: page.map((c) => c.id) } }, include: foodInclude })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const last = page[page.length - 1];
  return {
    // Mapped over `page`, not `rows`, so the ranked order survives the id-set refetch.
    items: page.flatMap((candidate) => {
      const row = byId.get(candidate.id);
      return row ? [shapeFood(row, lang)] : [];
    }),
    nextCursor: hasMore && last ? encodeRankCursor(last) : null,
    hasMore,
  };
};
