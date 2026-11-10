/**
 * "Cook dinner" suggestions: dishes that suit every selected eater, can be made with
 * the kitchen's equipment, and (optionally) mostly from what's at home.
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
  buildDinnerFilters,
  compareDinner,
  cookableFromPantry,
  missingIngredientIds,
  type DinnerCandidate,
  type DinnerEater,
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
  /** Ingredients not in the pantry — a shopping list. [] when the pantry is empty. */
  missingIngredients: MissingIngredientView[];
}

/** Everything about the account owner that dinner needs, in one read. */
const loadSelf = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
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
  }));
  if (includeSelf) {
    table.push({
      diets: self.diets.map((d) => d.diet.code),
      foodExceptions: self.foodExceptions.map((x) => x.value),
      foodPreferences: self.foodPreferences.map((p) => p.value),
      medicalRestrictions: self.medicalRestrictions,
    });
  }

  const { where, unmappedDiets } = buildDinnerFilters(table, self.kitchen?.appliances ?? null);
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
        ingredients: { select: { ingredientId: true }, orderBy: { position: 'asc' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_CANDIDATES,
    }),
    loadTasteSignals(userId),
    listCuisines(),
  ]);

  // The table's combined likes are scored like the feed's declared preferences.
  const declared = buildDeclaredScoring(
    { diets: [], foodExceptions: [], foodPreferences: table.flatMap((e) => e.foodPreferences) },
    cuisineCodes,
    [],
  );

  const ranked: DinnerCandidate[] = rows
    .filter(
      (row) =>
        !fromPantry ||
        cookableFromPantry(
          row.ingredients.map((i) => i.ingredientId),
          pantry,
          maxMissing,
        ),
    )
    .map((row) => {
      const candidate = toCandidate(row);
      return {
        ...candidate,
        score: scoreCandidate(candidate, signals, declared),
        missing: pantry.size
          ? missingIngredientIds(
              row.ingredients.map((i) => i.ingredientId),
              pantry,
            )
          : [],
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
      const food = shapeFood(row, lang);
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
