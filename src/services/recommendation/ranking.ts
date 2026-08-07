/**
 * The recommendation feed's ranking logic: which dishes a user must never be shown,
 * and how to order the rest by how well they fit that user's taste.
 *
 * Kept pure — no Prisma client, no env, no I/O — so it can be unit-tested directly
 * (see ranking.test.ts). `recommendationService` does the querying and hands the
 * results in. The only Prisma dependency is the `Prisma.FoodWhereInput` *type*,
 * which is erased at compile time.
 *
 * Two distinct mechanisms, and the split matters:
 *
 *  - **Hard filters** (`buildHardFilters`) become SQL `WHERE` fragments. Used only
 *    for things that must never appear: a declared allergen or intolerance, a dish
 *    that doesn't comply with a declared diet, an explicitly excluded ingredient.
 *  - **Scoring** (`scoreCandidate`) only reorders. Used for everything about taste,
 *    so a preference can never empty the deck — it just sinks to the bottom.
 *
 * Caveat worth stating plainly: the server can only filter on what the catalog
 * declares. A dish whose allergen row is missing or wrong will not be caught here,
 * so this is dietary best-effort, not a medical guarantee.
 */

import type { Prisma } from '@prisma/client';
import { TAG_GROUPS, toTagCode, type TagGroup } from '../../utils/tagVocabulary';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The user-declared half of the taste profile, straight from their account. */
export interface TasteProfile {
  /** Diet catalog codes, e.g. "VEGAN" (see the `diets` table). */
  diets: string[];
  /** Free-form "avoid this" entries, e.g. "peanuts", "молоко", "mushrooms". */
  foodExceptions: string[];
  /** Free-form "I like this" entries, e.g. "spicy", "italian". */
  foodPreferences: string[];
}

/**
 * The learned half: what the user's own verdicts imply. Affinities are expressed as
 * a *share* of that user's likes (0..1) rather than raw counts, so a user with 5
 * likes and one with 500 produce comparable score magnitudes. Dislikes stay as
 * counts and are saturated at scoring time.
 */
export interface TasteSignals {
  /** cuisine code -> share of this user's likes carrying it. */
  likedCuisines: Map<string, number>;
  /** tag code -> share of this user's likes carrying it. */
  likedTags: Map<string, number>;
  /** cuisine code -> times rejected with an explicit WRONG_CUISINE reason. */
  explicitCuisineDislikes: Map<string, number>;
  /** tag code -> times rejected with an explicit DISLIKE_TAG reason. */
  explicitTagDislikes: Map<string, number>;
  /** cuisine code -> times it appeared on *any* disliked dish (weaker signal). */
  implicitCuisineDislikes: Map<string, number>;
  /** False for a brand-new account, which disables the exploration bonus. */
  hasAnySignal: boolean;
}

/** The scoring-relevant slice of a dish — no translations, images, or ingredients. */
export interface Candidate {
  id: string;
  createdAt: Date;
  cuisine: string | null;
  /** UPPER_SNAKE codes from the dish's features + diets + dietaryRestrictions rows. */
  tags: string[];
}

/** The sort key the feed is served in, and what a feed cursor carries. */
export interface RankKey {
  score: number;
  createdAt: Date;
  id: string;
}

export interface RankedCandidate extends Candidate, RankKey {}

/** A single boolean tag column, identified by its table and column name. */
export interface TagTarget {
  group: TagGroup;
  key: string;
}

// ---------------------------------------------------------------------------
// Free-text -> tag resolution
// ---------------------------------------------------------------------------

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * Every way a user might have written a tag, mapped to the column(s) it means.
 * Built from the vocabulary's codes and its localized labels, so "peanuts",
 * "PEANUTS", "Peanuts" and "Арахис" all resolve to `allergens.peanuts`.
 *
 * An alias can map to more than one column on purpose: "gluten" is both an allergen
 * and an intolerance, and a user who typed it means both. Resolving to all matches
 * (rather than picking one by precedence) is the safer reading.
 */
const buildTagIndex = (): Map<string, TagTarget[]> => {
  const index = new Map<string, TagTarget[]>();

  const add = (alias: string, target: TagTarget): void => {
    const key = normalize(alias);
    if (!key) return;
    const existing = index.get(key);
    if (!existing) {
      index.set(key, [target]);
      return;
    }
    if (!existing.some((t) => t.group === target.group && t.key === target.key)) {
      existing.push(target);
    }
  };

  for (const { group, keys, labels } of TAG_GROUPS) {
    for (const key of keys) {
      const target: TagTarget = { group, key };
      add(key, target); // treeNuts
      add(toTagCode(key), target); // TREE_NUTS
      add(toTagCode(key).replace(/_/g, ' '), target); // tree nuts
      for (const label of Object.values(labels[key] ?? {})) add(label, target); // Tree nuts / Орехи
    }
  }
  return index;
};

const TAG_INDEX = buildTagIndex();

/** The tag column(s) a free-text entry refers to, or `[]` if it isn't a known tag. */
export const resolveTagAliases = (value: string): TagTarget[] => TAG_INDEX.get(normalize(value)) ?? [];

// ---------------------------------------------------------------------------
// Diet code -> dish predicate
// ---------------------------------------------------------------------------

/**
 * `requires` — the dish must carry *every* listed flag (a compliance claim, e.g.
 * VEGAN means `dietaryRestrictions.vegan = true`).
 * `excludes` — the dish must carry *none* of them (a "free of X" claim, which the
 * schema models as the presence of the offending trait, not its absence).
 */
export type DietRule =
  | { kind: 'requires'; targets: TagTarget[] }
  | { kind: 'excludes'; targets: TagTarget[] };

/**
 * How each diet catalog code constrains a dish. Note the two shapes are not
 * interchangeable: the schema has a `dietaryRestrictions.vegan` compliance flag but
 * no "lactoseFree" flag, so LACTOSE_FREE has to be expressed as the absence of
 * `intolerances.lactose` (and of the `milk` allergen) instead.
 *
 * Codes present in the seeded catalog plus the ones the dish tables can already
 * express, so adding e.g. KETO to the catalog needs no code change here. A code
 * with no entry cannot be filtered on — `buildHardFilters` reports it rather than
 * silently ignoring it.
 */
export const DIET_RULES: Record<string, DietRule> = {
  VEGETARIAN: { kind: 'requires', targets: [{ group: 'dietaryRestrictions', key: 'vegetarian' }] },
  VEGAN: { kind: 'requires', targets: [{ group: 'dietaryRestrictions', key: 'vegan' }] },
  PESCATARIAN: { kind: 'requires', targets: [{ group: 'dietaryRestrictions', key: 'pescatarian' }] },
  HALAL: { kind: 'requires', targets: [{ group: 'dietaryRestrictions', key: 'halal' }] },
  KOSHER: { kind: 'requires', targets: [{ group: 'dietaryRestrictions', key: 'kosher' }] },
  KETO: { kind: 'requires', targets: [{ group: 'diets', key: 'keto' }] },
  PALEO: { kind: 'requires', targets: [{ group: 'diets', key: 'paleo' }] },
  MEDITERRANEAN: { kind: 'requires', targets: [{ group: 'diets', key: 'mediterranean' }] },
  DIABETIC_FRIENDLY: { kind: 'requires', targets: [{ group: 'diets', key: 'diabeticFriendly' }] },
  LOW_GI: { kind: 'requires', targets: [{ group: 'diets', key: 'lowGi' }] },
  LACTOSE_FREE: {
    kind: 'excludes',
    targets: [
      { group: 'intolerances', key: 'lactose' },
      { group: 'allergens', key: 'milk' },
    ],
  },
  GLUTEN_FREE: {
    kind: 'excludes',
    targets: [
      { group: 'intolerances', key: 'gluten' },
      { group: 'allergens', key: 'gluten' },
      // Wheat implies gluten, so a wheat-tagged dish can't be served as gluten-free.
      { group: 'allergens', key: 'wheat' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Hard filters
// ---------------------------------------------------------------------------

/** "The dish has this tag row, and this flag on it is true." */
const requireTag = ({ group, key }: TagTarget): Prisma.FoodWhereInput =>
  ({ [group]: { is: { [key]: true } } }) as Prisma.FoodWhereInput;

/**
 * The set complement of {@link requireTag} — written as `NOT { is }` rather than
 * `isNot` so that a dish with *no* tag row at all is kept. That asymmetry is
 * deliberate: a missing row means "nobody has claimed this dish contains X", which
 * for an exclusion should pass, whereas for a `requires` compliance check the same
 * missing row correctly fails (we won't assert a dish is vegan without being told).
 */
const excludeTag = (target: TagTarget): Prisma.FoodWhereInput => ({ NOT: requireTag(target) });

/** "The dish has no ingredient line whose name is exactly this, in any language." */
const excludeIngredientNamed = (value: string): Prisma.FoodWhereInput => ({
  ingredients: {
    none: { ingredient: { translations: { some: { name: { equals: value, mode: 'insensitive' } } } } },
  },
});

export interface HardFilters {
  /** Prisma `WHERE` fragments, all of which must hold (ANDed by the caller). */
  where: Prisma.FoodWhereInput[];
  /**
   * Exceptions that turned out to name a *taste* tag rather than an allergen or
   * intolerance (e.g. "spicy"). Ranked down hard instead of filtered out, so a
   * catalog this size can't be reduced to an empty deck by a matter of taste.
   */
  penalizedTags: string[];
  /** Declared diet codes absent from {@link DIET_RULES} — reported, not filtered. */
  unmappedDiets: string[];
}

/**
 * Translates the declared profile into the constraints a dish must satisfy.
 *
 * A free-text exception that names no known tag is treated as an ingredient name
 * and matched exactly (case-insensitively) against the ingredient catalog. Exact
 * rather than substring on purpose: `contains` would have "egg" exclude every
 * dish with eggplant, and "oil" exclude nearly everything. The consequence is that
 * a near-miss spelling silently fails to exclude, which is why the safety-critical
 * allergen path goes through the label index above instead — that one matches codes
 * and localized names, not raw ingredient text.
 */
export const buildHardFilters = (profile: TasteProfile): HardFilters => {
  const where: Prisma.FoodWhereInput[] = [];
  const penalizedTags: string[] = [];
  const unmappedDiets: string[] = [];

  for (const code of profile.diets) {
    const rule = DIET_RULES[code.trim().toUpperCase()];
    if (!rule) {
      unmappedDiets.push(code);
      continue;
    }
    const build = rule.kind === 'requires' ? requireTag : excludeTag;
    for (const target of rule.targets) where.push(build(target));
  }

  for (const raw of profile.foodExceptions) {
    const value = raw.trim();
    if (!value) continue;

    const targets = resolveTagAliases(value);
    if (!targets.length) {
      where.push(excludeIngredientNamed(value));
      continue;
    }
    for (const target of targets) {
      if (target.group === 'allergens' || target.group === 'intolerances') {
        where.push(excludeTag(target));
      } else {
        penalizedTags.push(toTagCode(target.key));
      }
    }
  }

  return { where, penalizedTags, unmappedDiets };
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Relative pull of each signal. Tuned by hand for one property: an explicit verdict
 * outranks an inferred one. A cuisine the user keeps rejecting (-3) sinks below a
 * cuisine they merely have no opinion on (+0.5), which itself outranks one they've
 * rejected once by implication (-0.75 × 1/3).
 */
export const WEIGHTS = {
  /** × the share of the user's likes carrying this cuisine. */
  cuisineAffinity: 3,
  /** × the share of the user's likes carrying this tag, summed over the dish's tags. */
  tagAffinity: 1.5,
  /** Per tag/cuisine the user explicitly declared a preference for. */
  declaredPreference: 2,
  /** A cuisine the user has no verdict on at all — see the exploration note below. */
  novelCuisine: 0.5,
  explicitCuisineDislike: -3,
  explicitTagDislike: -2.5,
  implicitCuisineDislike: -0.75,
  /** A tag the user asked to avoid, that isn't an allergen/intolerance. */
  penalizedTag: -4,
} as const;

/**
 * Repeated rejections deepen a penalty but saturate, so three "no"s and thirty
 * behave the same — past that the dish is already at the bottom of the deck and
 * further precision buys nothing.
 */
const DISLIKE_SATURATION = 3;
const saturate = (count: number): number => Math.min(count, DISLIKE_SATURATION) / DISLIKE_SATURATION;

/** Declared preferences resolved to the codes a dish actually carries. */
export interface DeclaredScoring {
  preferredTags: Set<string>;
  preferredCuisines: Set<string>;
  penalizedTags: Set<string>;
}

/**
 * Resolves the free-text preference list against the tag vocabulary and the cuisine
 * catalog (passed in, since it's server-owned data this module doesn't query).
 * Entries that match neither are dropped — they're free text a user typed, and
 * there's nothing to score them against until onboarding captures structured
 * choices instead.
 */
export const buildDeclaredScoring = (
  profile: TasteProfile,
  cuisineCodes: string[],
  penalizedTags: string[],
): DeclaredScoring => {
  const cuisineAliases = new Map<string, string>();
  for (const code of cuisineCodes) {
    cuisineAliases.set(normalize(code), code);
    cuisineAliases.set(normalize(code.replace(/_/g, ' ')), code);
  }

  const preferredTags = new Set<string>();
  const preferredCuisines = new Set<string>();
  for (const raw of profile.foodPreferences) {
    const value = normalize(raw);
    if (!value) continue;
    for (const target of resolveTagAliases(value)) preferredTags.add(toTagCode(target.key));
    const cuisine = cuisineAliases.get(value);
    if (cuisine) preferredCuisines.add(cuisine);
  }
  return { preferredTags, preferredCuisines, penalizedTags: new Set(penalizedTags) };
};

/**
 * How well one dish fits the user. Higher is better; negative means actively
 * mismatched. Deterministic by design — no random jitter — because the feed's
 * cursor encodes a score, so the same dish must score identically across the
 * requests that page through one deck. Exploration is instead handled by
 * `novelCuisine`, which lifts cuisines the user has no verdict on above ones
 * they've already rejected, keeping a learned deck from collapsing into a
 * single cuisine.
 */
export const scoreCandidate = (
  candidate: Candidate,
  signals: TasteSignals,
  declared: DeclaredScoring,
): number => {
  let score = 0;
  const { cuisine } = candidate;

  if (cuisine) {
    score += WEIGHTS.cuisineAffinity * (signals.likedCuisines.get(cuisine) ?? 0);
    score += WEIGHTS.explicitCuisineDislike * saturate(signals.explicitCuisineDislikes.get(cuisine) ?? 0);
    score += WEIGHTS.implicitCuisineDislike * saturate(signals.implicitCuisineDislikes.get(cuisine) ?? 0);
    if (declared.preferredCuisines.has(cuisine)) score += WEIGHTS.declaredPreference;

    const known =
      signals.likedCuisines.has(cuisine) ||
      signals.explicitCuisineDislikes.has(cuisine) ||
      signals.implicitCuisineDislikes.has(cuisine);
    if (signals.hasAnySignal && !known) score += WEIGHTS.novelCuisine;
  }

  for (const tag of candidate.tags) {
    score += WEIGHTS.tagAffinity * (signals.likedTags.get(tag) ?? 0);
    score += WEIGHTS.explicitTagDislike * saturate(signals.explicitTagDislikes.get(tag) ?? 0);
    if (declared.preferredTags.has(tag)) score += WEIGHTS.declaredPreference;
    if (declared.penalizedTags.has(tag)) score += WEIGHTS.penalizedTag;
  }

  return score;
};

/**
 * The feed's total order: best score first, newest first within a score, id
 * descending as the final tiebreak. Returns < 0 when `a` is served before `b`.
 *
 * Every component is needed: score alone leaves ties (very common — most dishes
 * score 0 for a new user), and a stable total order is what makes the keyset
 * cursor able to say "resume strictly after this key" without an offset.
 */
export const compareRank = (a: RankKey, b: RankKey): number =>
  b.score - a.score ||
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Scores every candidate and sorts them into the order the feed serves them in. */
export const rankCandidates = (
  candidates: Candidate[],
  signals: TasteSignals,
  declared: DeclaredScoring,
): RankedCandidate[] =>
  candidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, signals, declared) }))
    .sort(compareRank);

/** An empty signal set — a user who has never swiped. */
export const emptySignals = (): TasteSignals => ({
  likedCuisines: new Map(),
  likedTags: new Map(),
  explicitCuisineDislikes: new Map(),
  explicitTagDislikes: new Map(),
  implicitCuisineDislikes: new Map(),
  hasAnySignal: false,
});
