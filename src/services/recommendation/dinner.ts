/**
 * The "cook dinner" rules: which dishes suit *everyone* at the table, given each
 * eater's diets, allergies, dislikes, doctor's restrictions and age, the kitchen's
 * equipment, and what's in the pantry — and in what order to offer them.
 *
 * Pure like `ranking.ts` (no Prisma client, no env, no I/O) so the rules are
 * unit-tested directly — see dinner.test.ts. `dinnerService` does the querying.
 *
 * Built on the feed's own hard filters rather than a parallel set of rules: an
 * allergy or a diet must mean exactly the same thing in the feed and at dinner.
 * Deliberate differences from the feed:
 *
 *  - A taste exception ("spicy") *excludes* here, where the feed only ranks it down.
 *    The feed must never empty itself over taste; a dinner for a specific table is
 *    the opposite case — a dish someone at the table won't eat isn't a suggestion.
 *  - Doctor's restrictions, children's ages, kitchen equipment, "is this a dinner
 *    dish at all" and the dinner-specific ranking (main course first, no three-hour
 *    projects, a daily shuffle) exist only here.
 */

import type { KitchenAppliance, Prisma } from '@prisma/client';
import { APPLIANCE_KEYS, toTagCode } from '../../utils/tagVocabulary';
import {
  buildHardFilters,
  compareRank,
  excludeTag,
  requireTag,
  resolveTagAliases,
  type RankedCandidate,
  type TasteProfile,
} from './ranking';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Mirrors the MedicalRestriction enum in schema.prisma. */
export type MedicalRestrictionCode =
  'LOW_CALORIE' | 'LOW_FAT' | 'LOW_CARB' | 'NO_SPICY' | 'LOW_SALT' | 'LOW_SUGAR';

/**
 * One person at the table, normalized to the feed's profile shape. For a household
 * eater, `foodExceptions` is their allergens plus their "won't eat" list — the same
 * resolution (allergen codes and names → tag exclusion, anything else → ingredient
 * name) applies to both.
 */
export interface DinnerEater extends TasteProfile {
  medicalRestrictions: MedicalRestrictionCode[];
  /** Whole years, or null when not given. Checked against a dish's minimum age. */
  age: number | null;
}

/**
 * Per-serving ceilings used when a dish has no explicit "low X" feature flag but does
 * have nutrition. Rough dinner-sized portions — a hint, not a clinical threshold.
 */
export const MEDICAL_LIMITS = {
  lowCalorieMaxKcal: 500,
  lowFatMaxGrams: 15,
  lowCarbMaxGrams: 20,
} as const;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const feature = (key: string) => ({ group: 'features' as const, key });

/**
 * What one doctor's restriction requires of a dish. The "low X" restrictions accept
 * either the dish's explicit flag or its nutrition under the limit; a dish with
 * neither is rejected, since nobody has claimed it's suitable. The "no X" ones are
 * exclusions, so a dish without a features row passes them — same convention as an
 * allergen exclusion.
 */
export const medicalFilter = (code: MedicalRestrictionCode): Prisma.FoodWhereInput => {
  switch (code) {
    case 'LOW_CALORIE':
      return {
        OR: [
          requireTag(feature('lowCalorie')),
          { nutrition: { is: { calories: { lte: MEDICAL_LIMITS.lowCalorieMaxKcal } } } },
        ],
      };
    case 'LOW_FAT':
      return {
        OR: [
          requireTag(feature('lowFat')),
          { nutrition: { is: { fat: { lte: MEDICAL_LIMITS.lowFatMaxGrams } } } },
        ],
      };
    case 'LOW_CARB':
      return {
        OR: [
          requireTag(feature('lowCarb')),
          requireTag({ group: 'diets', key: 'keto' }),
          { nutrition: { is: { carbs: { lte: MEDICAL_LIMITS.lowCarbMaxGrams } } } },
        ],
      };
    case 'NO_SPICY':
      return { AND: [excludeTag(feature('spicy')), excludeTag(feature('verySpicy'))] };
    case 'LOW_SALT':
      return excludeTag(feature('highSodium'));
    case 'LOW_SUGAR':
      return excludeTag(feature('highSugar'));
  }
};

/**
 * "The dish needs nothing this kitchen lacks." `null` means the user never said what
 * they have, which constrains nothing — guessing would hide dishes for no reason.
 * A dish with no appliances row needs nothing special and always passes.
 *
 * Two parts: every *required* appliance (a FoodAppliances column) must be in the
 * kitchen, and every "any one of these" choice (FoodApplianceOption) must have at
 * least one appliance that is. A dish with no choices passes the second part, which is
 * how `every` reads an empty relation. An empty kitchen can satisfy no choice; that's
 * written as "has no choices" because `hasSome: []` is not a meaningful SQL test.
 */
export const applianceFilters = (available: string[] | null): Prisma.FoodWhereInput[] => {
  if (available === null) return [];
  const have = new Set(available);
  const required = APPLIANCE_KEYS.filter((key) => !have.has(toTagCode(key))).map((key) =>
    excludeTag({ group: 'appliances', key }),
  );
  const choices: Prisma.FoodWhereInput = have.size
    ? { applianceOptions: { every: { appliances: { hasSome: [...have] as KitchenAppliance[] } } } }
    : { applianceOptions: { none: {} } };
  return [...required, choices];
};

/**
 * The equipment you'll cook a dish with: everything it requires, plus one appliance from
 * each "any one of these" choice — the first one the kitchen has, or the recipe's own
 * first choice when the kitchen is unknown. Shown to the user, never filtered on.
 */
export const appliancesToUse = (
  required: string[],
  options: string[][],
  kitchen: readonly string[] | null,
): string[] => {
  const have = kitchen ? new Set(kitchen) : null;
  const use = new Set(required);
  for (const choice of options) {
    const pick = (have && choice.find((a) => have.has(a))) || choice[0];
    if (pick) use.add(pick);
  }
  return [...use];
};

/** Courses that make a dinner on their own. A side, a dessert or a sauce is only part of one. */
export const DINNER_COURSES = ['MAIN', 'SOUP', 'SALAD'] as const;

/**
 * "This is something you'd cook for dinner": a dinner course, meant for dinner, with an
 * ingredient list. Unknown course or meal types pass (a dish authored in the admin panel
 * has neither), but a dish without ingredients doesn't — a dinner suggestion is something
 * to cook, and there's nothing to cook or shop for without a list.
 */
export const dinnerDishFilters = (): Prisma.FoodWhereInput[] => [
  { OR: [{ course: null }, { course: { in: [...DINNER_COURSES] } }] },
  { OR: [{ mealTypes: { isEmpty: true } }, { mealTypes: { has: 'DINNER' } }] },
  { ingredients: { some: {} } },
];

/**
 * Children at the table: the dish's minimum age must not exceed the youngest eater's
 * age (raw fish, alcohol that isn't cooked off, whole nuts...). An eater without an age
 * constrains nothing, and neither does a dish without a minimum.
 */
export const ageFilters = (eaters: DinnerEater[]): Prisma.FoodWhereInput[] => {
  const ages = eaters.map((e) => e.age).filter((age): age is number => age !== null);
  if (!ages.length) return [];
  return [{ OR: [{ minAgeYears: null }, { minAgeYears: { lte: Math.min(...ages) } }] }];
};

export interface DinnerFilters {
  /** Prisma `WHERE` fragments, all of which must hold. */
  where: Prisma.FoodWhereInput[];
  /** Diet codes no dish column can express — reported, not filtered (as in the feed). */
  unmappedDiets: string[];
}

/** Everything a dish must satisfy to be served to this whole table in this kitchen. */
export const buildDinnerFilters = (
  eaters: DinnerEater[],
  kitchenAppliances: string[] | null,
): DinnerFilters => {
  const where: Prisma.FoodWhereInput[] = [...dinnerDishFilters()];
  const unmappedDiets = new Set<string>();

  for (const eater of eaters) {
    const hard = buildHardFilters(eater);
    where.push(...hard.where);
    hard.unmappedDiets.forEach((code) => unmappedDiets.add(code));

    // The feed only penalizes taste tags; for dinner they exclude (see header).
    for (const raw of eater.foodExceptions) {
      for (const target of resolveTagAliases(raw)) {
        if (target.group !== 'allergens' && target.group !== 'intolerances') {
          where.push(excludeTag(target));
        }
      }
    }

    for (const code of eater.medicalRestrictions) where.push(medicalFilter(code));
  }

  where.push(...ageFilters(eaters));
  where.push(...applianceFilters(kitchenAppliances));
  return { where, unmappedDiets: [...unmappedDiets] };
};

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

/** One line of a dish's ingredient list, as far as the pantry is concerned. */
export interface DishIngredient {
  ingredientId: string;
  /** "If you like" / "for serving" — not needed to cook the dish. */
  optional: boolean;
  /** Salt, pepper, oil, water...: assumed to be in every kitchen. */
  staple: boolean;
}

/**
 * What still has to be bought, in recipe order: the needed lines that aren't in the
 * pantry. Optional lines and staples never count — otherwise "salt, pepper, oil" would
 * use up the whole `maxMissing` allowance of nearly every recipe.
 */
export const missingIngredientIds = (lines: DishIngredient[], pantry: Set<string>): string[] =>
  lines
    .filter((l) => !l.optional && !l.staple && !pantry.has(l.ingredientId))
    .map((l) => l.ingredientId);

/**
 * Whether a dish can be cooked from what's at home, allowing `maxMissing` purchases.
 * A dish with no ingredient list is never "from home" — we can't know what it needs.
 */
export const cookableFromPantry = (
  lines: DishIngredient[],
  pantry: Set<string>,
  maxMissing: number,
): boolean => lines.length > 0 && missingIngredientIds(lines, pantry).length <= maxMissing;

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** What dinner ranks a dish on beyond taste. All null for an admin-authored dish. */
export interface DinnerTraits {
  course: string | null;
  totalTimeMin: number | null;
  difficulty: number | null;
}

/**
 * Hand-tuned like the feed's WEIGHTS, and on the same scale: one declared preference
 * is worth 2 there, so everything here nudges the order without overriding taste.
 */
export const DINNER_WEIGHTS = {
  /** A main course is the most complete answer to "what's for dinner?". */
  mainCourse: 1,
  /** Total time (passive included) past which a weeknight dinner gets impractical. */
  longMinutes: 90,
  long: -0.75,
  /** ...and past which it's a weekend project. Replaces `long`, doesn't add to it. */
  veryLongMinutes: 180,
  veryLong: -1.5,
  /** Difficulty 3: advanced techniques or many stages. */
  hard: -0.5,
  /** Upper bound of the daily shuffle (see {@link dailyShuffle}). */
  variety: 1,
} as const;

/** How well a dish suits a dinner, independent of who's eating. */
export const dinnerFit = ({ course, totalTimeMin, difficulty }: DinnerTraits): number => {
  let score = 0;
  if (course === 'MAIN') score += DINNER_WEIGHTS.mainCourse;
  if (totalTimeMin !== null) {
    if (totalTimeMin > DINNER_WEIGHTS.veryLongMinutes) score += DINNER_WEIGHTS.veryLong;
    else if (totalTimeMin > DINNER_WEIGHTS.longMinutes) score += DINNER_WEIGHTS.long;
  }
  if (difficulty !== null && difficulty >= 3) score += DINNER_WEIGHTS.hard;
  return score;
};

/** The shuffle's seed: one per user per (UTC) day. */
export const varietySeed = (userId: string, now: Date): string =>
  `${userId}:${now.toISOString().slice(0, 10)}`;

/**
 * A number in [0, 1) for (seed, dish), the same every time for the same pair. Added to
 * the score (× `variety`) so that a new user — every dish scoring the same — doesn't get
 * the same twenty dishes every evening in catalog order, while one evening's list stays
 * stable across refreshes. FNV-1a with a murmur3 finalizer for an even spread.
 */
export const dailyShuffle = (seed: string, foodId: string): number => {
  const input = `${seed}:${foodId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
};

export interface DinnerCandidate extends RankedCandidate {
  missing: string[];
}

/**
 * Dinner order: when cooking from home, fewest missing ingredients first (the
 * shortest shopping trip wins); otherwise, and as the tiebreak, the score — taste plus
 * {@link dinnerFit} plus the daily shuffle — then the feed's own tiebreaks.
 */
export const compareDinner =
  (fromPantry: boolean) =>
  (a: DinnerCandidate, b: DinnerCandidate): number =>
    (fromPantry ? a.missing.length - b.missing.length : 0) || compareRank(a, b);
