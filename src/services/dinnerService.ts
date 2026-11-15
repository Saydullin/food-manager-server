/**
 * "Cook dinner" suggestions: dinner dishes that suit every selected eater (children's
 * ages included), can be made with the kitchen's equipment, and (optionally) mostly
 * from what's at home — staples like salt and oil assumed.
 *
 * Same two-phase shape as the feed (see recommendationService): score a lean
 * candidate set, then load the full dish shape for the handful being returned. The
 * rules themselves are in the pure `recommendation/dinner` module.
 */

import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { listCuisines } from './cuisineService';
import { DEFAULT_LANGUAGE, foodInclude, shapeFood, type FoodView } from './foodService';
import { getOwnedEaters, getPantryIds } from './householdService';
import {
  MAX_CANDIDATES,
  candidateSelect,
  loadTasteSignals,
  toCandidate,
} from './recommendationService';
import {
  DINNER_WEIGHTS,
  buildDinnerFilters,
  compareDinner,
  cookableFromPantry,
  dailyShuffle,
  dinnerFit,
  missingIngredientIds,
  varietySeed,
  type DinnerCandidate,
  type DinnerEater,
  type DishIngredient,
} from './recommendation/dinner';
import { buildDeclaredScoring, scoreCandidate } from './recommendation/ranking';

export interface DinnerParams {
  eaterIds: string[];
  includeSelf: boolean;
  source: 'ANY' | 'AT_HOME';
  maxMissing: number;
  limit: number;
  lang?: string;
}

export interface MissingIngredientView {
  ingredientId: string;
  name: string;
  amount: number;
  unit: string;
}

export interface DinnerSuggestion {
  food: FoodView;
  /**
   * Needed ingredients not in the pantry — a shopping list. Optional lines and staples
   * (salt, oil...) are never on it. [] when the pantry is empty.
   */
  missingIngredients: MissingIngredientView[];
}

/** Everything about the account owner that dinner needs, in one read. */
const loadSelf = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      age: true,
      medicalRestrictions: true,
      foodPreferences: { select: { value: true } },
      foodExceptions: { select: { value: true } },
      diets: { select: { diet: { select: { code: true } } } },
      kitchen: { select: { appliances: true } },
    },
  });
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return user;
};

export const getDinnerSuggestions = async (
  userId: string,
  { eaterIds, includeSelf, source, maxMissing, limit, lang = DEFAULT_LANGUAGE }: DinnerParams,
): Promise<{ suggestions: DinnerSuggestion[] }> => {
  const [self, household, pantry] = await Promise.all([
    loadSelf(userId),
    getOwnedEaters(userId, eaterIds),
    getPantryIds(userId),
  ]);

  const table: DinnerEater[] = household.map((e) => ({
    diets: e.diets,
    // Allergens and "won't eat" go through the same resolver as the feed's exceptions.
    foodExceptions: [...e.allergens, ...e.avoid],
    foodPreferences: e.likes,
    medicalRestrictions: e.medicalRestrictions,
    age: e.age,
  }));
  if (includeSelf) {
    table.push({
      diets: self.diets.map((d) => d.diet.code),
      foodExceptions: self.foodExceptions.map((x) => x.value),
      foodPreferences: self.foodPreferences.map((p) => p.value),
      medicalRestrictions: self.medicalRestrictions,
      age: self.age,
    });
  }

  const kitchen = self.kitchen?.appliances ?? null;
  const { where, unmappedDiets } = buildDinnerFilters(table, kitchen);
  if (unmappedDiets.length) {
    console.warn(
      `[dinner] user ${userId}: diet code(s) not filterable: ${unmappedDiets.join(', ')}`,
    );
  }

  const fromPantry = source === 'AT_HOME';
  const [rows, signals, cuisineCodes] = await Promise.all([
    prisma.food.findMany({
      where: {
        AND: [
          // A dish the user explicitly rejected isn't dinner. Liked and skipped ones are fine.
          { interactions: { none: { userId, action: 'DISLIKE' } } },
          ...where,
        ],
      },
      select: {
        ...candidateSelect,
        course: true,
        totalTimeMin: true,
        difficulty: true,
        ingredients: {
          select: {
            ingredientId: true,
            optional: true,
            ingredient: { select: { isStaple: true } },
          },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_CANDIDATES,
    }),
    loadTasteSignals(userId),
    listCuisines(),
  ]);
  if (rows.length === MAX_CANDIDATES) {
    console.warn(
      `[dinner] user ${userId}: candidate scan hit the ${MAX_CANDIDATES}-dish cap; ` +
        'older matching dishes are not being ranked — move scoring into SQL.',
    );
  }

  // The table's combined likes are scored like the feed's declared preferences.
  const declared = buildDeclaredScoring(
    { diets: [], foodExceptions: [], foodPreferences: table.flatMap((e) => e.foodPreferences) },
    cuisineCodes,
    [],
  );
  const seed = varietySeed(userId, new Date());

  const ranked: DinnerCandidate[] = rows
    .map((row) => ({
      row,
      lines: row.ingredients.map((i): DishIngredient => ({
        ingredientId: i.ingredientId,
        optional: i.optional,
        staple: i.ingredient.isStaple,
      })),
    }))
    .filter(({ lines }) => !fromPantry || cookableFromPantry(lines, pantry, maxMissing))
    .map(({ row, lines }) => {
      const candidate = toCandidate(row);
      return {
        ...candidate,
        score:
          scoreCandidate(candidate, signals, declared) +
          dinnerFit(row) +
          DINNER_WEIGHTS.variety * dailyShuffle(seed, row.id),
        missing: pantry.size ? missingIngredientIds(lines, pantry) : [],
      };
    })
    .sort(compareDinner(fromPantry))
    .slice(0, limit);

  const full = ranked.length
    ? await prisma.food.findMany({
        where: { id: { in: ranked.map((c) => c.id) } },
        include: foodInclude,
      })
    : [];
  const byId = new Map(full.map((row) => [row.id, row]));

  return {
    // Mapped over `ranked`, not `full`, so the dinner order survives the refetch.
    suggestions: ranked.flatMap((candidate) => {
      const row = byId.get(candidate.id);
      if (!row) return [];
      // With the kitchen, "oven or air fryer" shows the one this user actually has.
      const food = shapeFood(row, lang, kitchen);
      const missing = new Set(candidate.missing);
      return [
        {
          food,
          missingIngredients: food.ingredients
            .filter((i) => missing.has(i.ingredientId))
            .map(({ ingredientId, name, amount, unit }) => ({ ingredientId, name, amount, unit })),
        },
      ];
    }),
  };
};
