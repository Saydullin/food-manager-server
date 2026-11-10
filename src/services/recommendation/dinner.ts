/**
 * The "cook dinner" rules: which dishes suit *everyone* at the table, given each
 * eater's diets, allergies, dislikes and doctor's restrictions, the kitchen's
 * equipment, and what's in the pantry.
 *
 * Pure like `ranking.ts` (no Prisma client, no env, no I/O) so the rules are
 * unit-tested directly — see dinner.test.ts. `dinnerService` does the querying.
 *
 * Built on the feed's own hard filters rather than a parallel set of rules: an
 * allergy or a diet must mean exactly the same thing in the feed and at dinner.
 * Two deliberate differences from the feed:
 *
 *  - A taste exception ("spicy") *excludes* here, where the feed only ranks it down.
 *    The feed must never empty itself over taste; a dinner for a specific table is
 *    the opposite case — a dish someone at the table won't eat isn't a suggestion.
 *  - Doctor's restrictions and kitchen equipment exist only here.
 */

import type { Prisma } from '@prisma/client';
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
 */
export const applianceFilters = (available: string[] | null): Prisma.FoodWhereInput[] => {
  if (available === null) return [];
  const have = new Set(available);
  return APPLIANCE_KEYS.filter((key) => !have.has(toTagCode(key))).map((key) =>
    excludeTag({ group: 'appliances', key }),
  );
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
  const where: Prisma.FoodWhereInput[] = [];
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

  where.push(...applianceFilters(kitchenAppliances));
  return { where, unmappedDiets: [...unmappedDiets] };
};

// ---------------------------------------------------------------------------
// Pantry & ordering
// ---------------------------------------------------------------------------

/** The dish's ingredient ids that aren't in the pantry, in recipe order. */
export const missingIngredientIds = (dishIngredientIds: string[], pantry: Set<string>): string[] =>
  dishIngredientIds.filter((id) => !pantry.has(id));

/**
 * Whether a dish can be cooked from what's at home, allowing `maxMissing` purchases.
 * A dish with no ingredient list is never "from home" — we can't know what it needs.
 */
export const cookableFromPantry = (
  dishIngredientIds: string[],
  pantry: Set<string>,
  maxMissing: number,
): boolean =>
  dishIngredientIds.length > 0 &&
  missingIngredientIds(dishIngredientIds, pantry).length <= maxMissing;

export interface DinnerCandidate extends RankedCandidate {
  missing: string[];
}

/**
 * Dinner order: when cooking from home, fewest missing ingredients first (the
 * shortest shopping trip wins); otherwise, and as the tiebreak, the feed's own rank.
 */
export const compareDinner =
  (fromPantry: boolean) =>
  (a: DinnerCandidate, b: DinnerCandidate): number =>
    (fromPantry ? a.missing.length - b.missing.length : 0) || compareRank(a, b);
