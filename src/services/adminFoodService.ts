import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { decodeCursor } from '../utils/cursor';
import {
  ALLERGEN_KEYS,
  DIET_KEYS,
  FEATURE_KEYS,
  INTOLERANCE_KEYS,
  RESTRICTION_KEYS,
  flagsFrom,
  foodInclude,
  shapeFood,
  toPage,
  type FoodView,
  type Page,
} from './foodService';

export interface ListFoodsParams {
  search?: string;
  limit: number;
  cursor?: string;
}

/** Admin listing of every dish (no swipe-exclusion), optionally filtered by name. */
export const listFoods = async ({ search, limit, cursor }: ListFoodsParams): Promise<Page<FoodView>> => {
  const decoded = cursor ? decodeCursor(cursor) : null;

  const rows = await prisma.food.findMany({
    where: {
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { createdAt: decoded.createdAt, id: { lt: decoded.id } },
            ],
          }
        : {}),
    },
    include: foodInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  return toPage(rows, limit, (r) => ({ createdAt: r.createdAt, id: r.id }), shapeFood);
};

export interface FoodPayload {
  name?: string;
  description?: string | null;
  cuisineCode?: string | null;
  images?: string[];
  nutrition?: {
    calories?: number | null;
    servings?: number | null;
    protein?: number | null;
    fat?: number | null;
    carbs?: number | null;
  };
  allergens?: string[];
  dietaryRestrictions?: string[];
  intolerances?: string[];
  features?: string[];
  diets?: string[];
}

const resolveCuisineId = async (cuisineCode: string | null | undefined): Promise<string | null> => {
  if (!cuisineCode) return null;
  const cuisine = await prisma.cuisine.findUnique({ where: { code: cuisineCode } });
  if (!cuisine) throw AppError.badRequest(`Unknown cuisine code: ${cuisineCode}`, 'INVALID_CUISINE');
  return cuisine.id;
};

/**
 * Creates a dish. Mirrors the shape of foodService.seedSampleFoods's per-dish
 * transaction — same child-table upserts, just driven by the request body
 * instead of a hardcoded sample. Tag tables are always written (even when a
 * field is omitted, absent = no tags true) so every child row exists from the start.
 */
export const createFood = async (input: FoodPayload): Promise<FoodView> => {
  if (!input.name) throw AppError.badRequest('name is required', 'MISSING_NAME');

  const cuisineId = await resolveCuisineId(input.cuisineCode);

  const foodId = await prisma.$transaction(async (tx) => {
    const food = await tx.food.create({
      data: { name: input.name!, description: input.description ?? null, cuisineId },
    });

    await tx.foodImage.createMany({
      data: (input.images ?? []).map((url, position) => ({ foodId: food.id, url, position })),
    });

    if (input.nutrition) {
      await tx.foodNutrition.create({ data: { foodId: food.id, ...input.nutrition } });
    }

    await tx.foodAllergens.create({ data: { foodId: food.id, ...flagsFrom(ALLERGEN_KEYS, input.allergens) } });
    await tx.foodDietaryRestrictions.create({
      data: { foodId: food.id, ...flagsFrom(RESTRICTION_KEYS, input.dietaryRestrictions) },
    });
    await tx.foodIntolerances.create({
      data: { foodId: food.id, ...flagsFrom(INTOLERANCE_KEYS, input.intolerances) },
    });
    await tx.foodFeatures.create({ data: { foodId: food.id, ...flagsFrom(FEATURE_KEYS, input.features) } });
    await tx.foodDiets.create({ data: { foodId: food.id, ...flagsFrom(DIET_KEYS, input.diets) } });

    return food.id;
  });

  return getFoodOrThrow(foodId);
};

/**
 * Partially updates a dish. Only tables whose corresponding field was present in
 * `input` are touched — e.g. omitting `allergens` leaves existing allergen tags
 * untouched, while sending `allergens: []` clears them. Array fields replace the
 * child table in full (delete + recreate), matching the mobile-facing
 * setFoodPreferences/setFoodExceptions replace-in-full convention in userService.ts.
 */
export const updateFood = async (foodId: string, input: FoodPayload): Promise<FoodView> => {
  await getFoodOrThrow(foodId);

  const cuisineId =
    input.cuisineCode !== undefined ? await resolveCuisineId(input.cuisineCode) : undefined;

  await prisma.$transaction(async (tx) => {
    if (input.name !== undefined || input.description !== undefined || cuisineId !== undefined) {
      await tx.food.update({
        where: { id: foodId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(cuisineId !== undefined ? { cuisineId } : {}),
        },
      });
    }

    if (input.images !== undefined) {
      await tx.foodImage.deleteMany({ where: { foodId } });
      await tx.foodImage.createMany({
        data: input.images.map((url, position) => ({ foodId, url, position })),
      });
    }

    if (input.nutrition !== undefined) {
      await tx.foodNutrition.upsert({
        where: { foodId },
        create: { foodId, ...input.nutrition },
        update: input.nutrition,
      });
    }

    if (input.allergens !== undefined) {
      const data = flagsFrom(ALLERGEN_KEYS, input.allergens);
      await tx.foodAllergens.upsert({ where: { foodId }, create: { foodId, ...data }, update: data });
    }
    if (input.dietaryRestrictions !== undefined) {
      const data = flagsFrom(RESTRICTION_KEYS, input.dietaryRestrictions);
      await tx.foodDietaryRestrictions.upsert({
        where: { foodId },
        create: { foodId, ...data },
        update: data,
      });
    }
    if (input.intolerances !== undefined) {
      const data = flagsFrom(INTOLERANCE_KEYS, input.intolerances);
      await tx.foodIntolerances.upsert({ where: { foodId }, create: { foodId, ...data }, update: data });
    }
    if (input.features !== undefined) {
      const data = flagsFrom(FEATURE_KEYS, input.features);
      await tx.foodFeatures.upsert({ where: { foodId }, create: { foodId, ...data }, update: data });
    }
    if (input.diets !== undefined) {
      const data = flagsFrom(DIET_KEYS, input.diets);
      await tx.foodDiets.upsert({ where: { foodId }, create: { foodId, ...data }, update: data });
    }
  });

  return getFoodOrThrow(foodId);
};

/** Deletes a dish. Child tag/image/interaction rows cascade via the schema's onDelete: Cascade. */
export const deleteFood = async (foodId: string): Promise<void> => {
  await getFoodOrThrow(foodId);
  await prisma.food.delete({ where: { id: foodId } });
};

const getFoodOrThrow = async (foodId: string): Promise<FoodView> => {
  const row = await prisma.food.findUnique({ where: { id: foodId }, include: foodInclude });
  if (!row) throw AppError.notFound('Food not found', 'FOOD_NOT_FOUND');
  return shapeFood(row);
};
