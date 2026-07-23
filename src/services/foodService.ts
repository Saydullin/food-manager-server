import { Prisma, type FoodDislikeReason, type FoodInteractionAction } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { decodeCursor, encodeCursor } from '../utils/cursor';
import { ensureUserExists } from './userService';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

// A dish as the client consumes it in the swipe deck. The per-table boolean tags
// are flattened into arrays of UPPER_SNAKE codes (the same style the client already
// gets for diets), and the 1..7-image gallery is a plain ordered URL array.
export interface FoodTags {
  allergens: string[];
  dietaryRestrictions: string[];
  intolerances: string[];
  features: string[];
  diets: string[];
}

export interface FoodNutritionView {
  calories: number | null;
  servings: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

export interface FoodView {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  images: string[];
  nutrition: FoodNutritionView | null;
  tags: FoodTags;
  createdAt: Date;
  updatedAt: Date;
}

// A page of results, keyset-paginated. `nextCursor` is null on the last page.
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface InteractionView {
  foodId: string;
  action: FoodInteractionAction;
  reason: FoodDislikeReason | null;
  reasonDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// An entry in the "my likes/dislikes" list: the verdict plus the dish it was on.
export interface InteractionWithFoodView extends InteractionView {
  food: FoodView;
}

// ---------------------------------------------------------------------------
// Shaping helpers
// ---------------------------------------------------------------------------

// Everything shapeFood needs in one include, reused by every read path.
const foodInclude = {
  cuisine: { select: { code: true } },
  images: { select: { url: true }, orderBy: { position: 'asc' } },
  nutrition: true,
  allergens: true,
  dietaryRestrictions: true,
  intolerances: true,
  features: true,
  diets: true,
} satisfies Prisma.FoodInclude;

type FoodRow = Prisma.FoodGetPayload<{ include: typeof foodInclude }>;

// camelCase column name -> UPPER_SNAKE tag code (e.g. treeNuts -> TREE_NUTS).
const toTagCode = (key: string): string => key.replace(/([A-Z])/g, '_$1').toUpperCase();

// Flattens a boolean tag row (e.g. FoodAllergens) into the codes whose column is
// true, ignoring the non-boolean `foodId` key. A null row (no tags recorded) -> [].
const trueTags = (row: Record<string, unknown> | null): string[] =>
  row
    ? Object.entries(row)
        .filter(([, value]) => value === true)
        .map(([key]) => toTagCode(key))
    : [];

const shapeFood = (row: FoodRow): FoodView => ({
  id: row.id,
  name: row.name,
  description: row.description,
  cuisine: row.cuisine?.code ?? null,
  // Prefer the gallery; fall back to the legacy single cover so older rows still
  // return at least one image.
  images: row.images.length ? row.images.map((i) => i.url) : row.imageUrl ? [row.imageUrl] : [],
  nutrition: row.nutrition
    ? {
        calories: row.nutrition.calories,
        servings: row.nutrition.servings,
        protein: row.nutrition.protein,
        fat: row.nutrition.fat,
        carbs: row.nutrition.carbs,
      }
    : null,
  tags: {
    allergens: trueTags(row.allergens),
    dietaryRestrictions: trueTags(row.dietaryRestrictions),
    intolerances: trueTags(row.intolerances),
    features: trueTags(row.features),
    diets: trueTags(row.diets),
  },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const shapeInteraction = (row: {
  foodId: string;
  action: FoodInteractionAction;
  reason: FoodDislikeReason | null;
  reasonDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
}): InteractionView => ({
  foodId: row.foodId,
  action: row.action,
  reason: row.reason,
  reasonDetail: row.reasonDetail,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export interface FeedParams {
  limit: number;
  cursor?: string;
}

/**
 * A page of the recommendation deck for `userId`: dishes the user has NOT yet
 * swiped, newest first, keyset-paginated by `(createdAt, id)`.
 *
 * "Not yet swiped" is the `interactions: { none: { userId } }` filter — so as the
 * user likes/skips/hates dishes they drop out of subsequent pages automatically.
 * Ordering is newest-first for now; when preference-based ranking lands it slots in
 * here (the cursor contract and the swiped-set exclusion stay the same).
 */
export const getFeed = async (userId: string, { limit, cursor }: FeedParams): Promise<Page<FoodView>> => {
  const decoded = cursor ? decodeCursor(cursor) : null;

  const rows = await prisma.food.findMany({
    where: {
      interactions: { none: { userId } },
      // Keyset: strictly "after" the cursor in (createdAt DESC, id DESC) order.
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
    // One extra row tells us whether another page exists without a second query.
    take: limit + 1,
  });

  return toPage(rows, limit, (r) => ({ createdAt: r.createdAt, id: r.id }), shapeFood);
};

/** Full detail for a single dish. 404s if it doesn't exist. */
export const getFood = async (foodId: string): Promise<FoodView> => {
  const row = await prisma.food.findUnique({ where: { id: foodId }, include: foodInclude });
  if (!row) throw AppError.notFound('Food not found', 'FOOD_NOT_FOUND');
  return shapeFood(row);
};

// ---------------------------------------------------------------------------
// Interactions (swipes)
// ---------------------------------------------------------------------------

export interface RecordInteractionInput {
  action: FoodInteractionAction;
  reason?: FoodDislikeReason;
  reasonDetail?: string;
}

/**
 * Records (or re-records) the user's verdict on a dish. Idempotent per (user, dish):
 * swiping the same dish again overwrites the previous verdict — so a "skip" can
 * become a "like" without piling up rows. `reason`/`reasonDetail` are only stored
 * for a DISLIKE (validation already blocks them elsewhere; we null them here too so
 * a stale reason can't survive a LIKE that overwrites a prior DISLIKE).
 */
export const recordInteraction = async (
  userId: string,
  foodId: string,
  input: RecordInteractionInput,
): Promise<InteractionView> => {
  await ensureUserExists(userId);

  const food = await prisma.food.findUnique({ where: { id: foodId }, select: { id: true } });
  if (!food) throw AppError.notFound('Food not found', 'FOOD_NOT_FOUND');

  const isDislike = input.action === 'DISLIKE';
  const reason = isDislike ? (input.reason ?? null) : null;
  const reasonDetail = isDislike ? (input.reasonDetail ?? null) : null;

  const row = await prisma.foodInteraction.upsert({
    where: { userId_foodId: { userId, foodId } },
    create: { userId, foodId, action: input.action, reason, reasonDetail },
    update: { action: input.action, reason, reasonDetail },
  });
  return shapeInteraction(row);
};

/**
 * Undoes a swipe (Tinder-style "rewind"): removes the user's verdict on a dish so it
 * re-enters the feed. Idempotent — returns `removed: false` when there was nothing
 * to undo rather than 404ing, so a rewind button never errors.
 */
export const deleteInteraction = async (userId: string, foodId: string): Promise<{ removed: boolean }> => {
  const { count } = await prisma.foodInteraction.deleteMany({ where: { userId, foodId } });
  return { removed: count > 0 };
};

export interface ListInteractionsParams {
  action?: FoodInteractionAction;
  limit: number;
  cursor?: string;
}

/**
 * The user's own swipe history ("my likes / dislikes"), optionally filtered to one
 * action, newest first, keyset-paginated by the interaction's `(createdAt, id)`.
 * Each entry carries the full dish so a client can render the list without a second
 * round-trip.
 */
export const listInteractions = async (
  userId: string,
  { action, limit, cursor }: ListInteractionsParams,
): Promise<Page<InteractionWithFoodView>> => {
  const decoded = cursor ? decodeCursor(cursor) : null;

  const rows = await prisma.foodInteraction.findMany({
    where: {
      userId,
      ...(action ? { action } : {}),
      ...(decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { createdAt: decoded.createdAt, id: { lt: decoded.id } },
            ],
          }
        : {}),
    },
    include: { food: { include: foodInclude } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  return toPage(
    rows,
    limit,
    (r) => ({ createdAt: r.createdAt, id: r.id }),
    (r) => ({ ...shapeInteraction(r), food: shapeFood(r.food) }),
  );
};

// Trims a fetched `limit + 1` slice into a page: drops the probe row, computes
// hasMore, and builds nextCursor from the last kept row's keyset.
const toPage = <TRow, TOut>(
  rows: TRow[],
  limit: number,
  keyOf: (row: TRow) => { createdAt: Date; id: string },
  shape: (row: TRow) => TOut,
): Page<TOut> => {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return {
    items: kept.map(shape),
    nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null,
    hasMore,
  };
};

// ---------------------------------------------------------------------------
// Dev-only seed (mirrors the /dev keystore helpers — never mounted in production).
// ---------------------------------------------------------------------------

// A compact description of a sample dish; expanded into Food + child rows below.
interface SeedFood {
  id: string;
  name: string;
  description: string;
  cuisine: string;
  images: string[];
  nutrition: { calories: number; servings: number; protein: number; fat: number; carbs: number };
  features?: string[];
  allergens?: string[];
  intolerances?: string[];
  dietaryRestrictions?: string[];
  diets?: string[];
}

const SAMPLE_FOODS: SeedFood[] = [
  {
    id: 'f0000000-0000-4000-8000-000000000001',
    name: 'Margherita Pizza',
    description: 'Wood-fired pizza with San Marzano tomato, fresh mozzarella and basil.',
    cuisine: 'ITALIAN',
    images: [
      'https://images.example.com/foods/margherita-1.jpg',
      'https://images.example.com/foods/margherita-2.jpg',
    ],
    nutrition: { calories: 850, servings: 2, protein: 34, fat: 28, carbs: 108 },
    features: ['highSugar'],
    allergens: ['milk', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
    dietaryRestrictions: ['vegetarian'],
    diets: ['mediterranean'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000002',
    name: 'Spicy Tuna Roll',
    description: 'Sushi rolls with fresh tuna, sriracha mayo and cucumber.',
    cuisine: 'JAPANESE',
    images: ['https://images.example.com/foods/spicy-tuna-1.jpg'],
    nutrition: { calories: 320, servings: 1, protein: 24, fat: 9, carbs: 38 },
    features: ['spicy', 'highProtein', 'lowFat'],
    allergens: ['fish', 'soy', 'sesame'],
    dietaryRestrictions: ['pescatarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000003',
    name: 'Chicken Tikka Masala',
    description: 'Grilled chicken in a creamy spiced tomato curry, served with rice.',
    cuisine: 'INDIAN',
    images: [
      'https://images.example.com/foods/tikka-1.jpg',
      'https://images.example.com/foods/tikka-2.jpg',
      'https://images.example.com/foods/tikka-3.jpg',
    ],
    nutrition: { calories: 640, servings: 2, protein: 42, fat: 30, carbs: 45 },
    features: ['spicy', 'highProtein'],
    allergens: ['milk'],
    intolerances: ['lactose'],
    diets: ['lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000004',
    name: 'Vegan Buddha Bowl',
    description: 'Quinoa, roasted chickpeas, avocado, kale and tahini dressing.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://images.example.com/foods/buddha-bowl-1.jpg'],
    nutrition: { calories: 520, servings: 1, protein: 18, fat: 22, carbs: 62 },
    features: ['highFiber', 'lowFat', 'sugarFree'],
    allergens: ['sesame'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
    diets: ['mediterranean', 'paleo'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000005',
    name: 'Beef Tacos al Pastor',
    description: 'Marinated pork tacos with pineapple, onion and cilantro on corn tortillas.',
    cuisine: 'MEXICAN',
    images: [
      'https://images.example.com/foods/tacos-1.jpg',
      'https://images.example.com/foods/tacos-2.jpg',
    ],
    nutrition: { calories: 700, servings: 3, protein: 38, fat: 34, carbs: 58 },
    features: ['spicy', 'highProtein'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000006',
    name: 'Pad Thai',
    description: 'Stir-fried rice noodles with shrimp, egg, peanuts and tamarind sauce.',
    cuisine: 'THAI',
    images: ['https://images.example.com/foods/pad-thai-1.jpg'],
    nutrition: { calories: 600, servings: 2, protein: 26, fat: 20, carbs: 80 },
    features: ['spicy'],
    allergens: ['peanuts', 'eggs', 'shellfish', 'fish', 'soy'],
    dietaryRestrictions: ['pescatarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000007',
    name: 'Keto Bunless Burger',
    description: 'Grass-fed beef patty, cheddar and bacon wrapped in crisp lettuce.',
    cuisine: 'AMERICAN',
    images: ['https://images.example.com/foods/keto-burger-1.jpg'],
    nutrition: { calories: 560, servings: 1, protein: 40, fat: 42, carbs: 6 },
    features: ['lowCarb', 'highProtein', 'sugarFree'],
    allergens: ['milk'],
    intolerances: ['lactose'],
    diets: ['keto', 'paleo'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000008',
    name: 'Tiramisu',
    description: 'Espresso-soaked ladyfingers layered with mascarpone cream and cocoa.',
    cuisine: 'ITALIAN',
    images: [
      'https://images.example.com/foods/tiramisu-1.jpg',
      'https://images.example.com/foods/tiramisu-2.jpg',
    ],
    nutrition: { calories: 450, servings: 4, protein: 8, fat: 26, carbs: 42 },
    features: ['sweet', 'highSugar'],
    allergens: ['milk', 'eggs', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
    dietaryRestrictions: ['vegetarian'],
  },
];

// Builds the boolean-column object for a tag table from the list of true codes.
const flagsFrom = (keys: string[], on: string[] | undefined): Record<string, boolean> =>
  Object.fromEntries(keys.map((k) => [k, (on ?? []).includes(k)]));

const ALLERGEN_KEYS = ['milk', 'eggs', 'peanuts', 'treeNuts', 'soy', 'wheat', 'gluten', 'fish', 'shellfish', 'sesame', 'mustard', 'celery', 'lupin', 'molluscs', 'sulfites'];
const RESTRICTION_KEYS = ['vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher'];
const INTOLERANCE_KEYS = ['lactose', 'gluten', 'fructose', 'histamine'];
const FEATURE_KEYS = ['spicy', 'verySpicy', 'lowCarb', 'highProtein', 'lowFat', 'lowCalorie', 'highFiber', 'highSugar', 'highSodium', 'sweet', 'sugarFree'];
const DIET_KEYS = ['keto', 'paleo', 'mediterranean', 'diabeticFriendly', 'lowGi'];

/**
 * Seeds a fixed set of sample dishes (with images, nutrition, cuisine and tags) so
 * the feed is testable end-to-end from Postman. Idempotent — dishes use fixed UUIDs
 * and are upserted, so re-running refreshes them in place instead of duplicating.
 * Dev-only, like the /dev keystore helpers.
 */
export const seedSampleFoods = async (): Promise<{ count: number }> => {
  const cuisines = await prisma.cuisine.findMany({ select: { id: true, code: true } });
  const cuisineIdByCode = new Map(cuisines.map((c) => [c.code, c.id]));

  for (const food of SAMPLE_FOODS) {
    const cuisineId = cuisineIdByCode.get(food.cuisine) ?? null;
    const base = { name: food.name, description: food.description, cuisineId };

    await prisma.$transaction(async (tx) => {
      await tx.food.upsert({ where: { id: food.id }, create: { id: food.id, ...base }, update: base });

      // Child rows: replace-in-full so a re-seed reflects edits to SAMPLE_FOODS.
      await tx.foodImage.deleteMany({ where: { foodId: food.id } });
      await tx.foodImage.createMany({
        data: food.images.map((url, position) => ({ foodId: food.id, url, position })),
      });

      const nutrition = { foodId: food.id, ...food.nutrition };
      await tx.foodNutrition.upsert({ where: { foodId: food.id }, create: nutrition, update: nutrition });

      const allergens = { foodId: food.id, ...flagsFrom(ALLERGEN_KEYS, food.allergens) };
      await tx.foodAllergens.upsert({ where: { foodId: food.id }, create: allergens, update: allergens });

      const restrictions = { foodId: food.id, ...flagsFrom(RESTRICTION_KEYS, food.dietaryRestrictions) };
      await tx.foodDietaryRestrictions.upsert({ where: { foodId: food.id }, create: restrictions, update: restrictions });

      const intolerances = { foodId: food.id, ...flagsFrom(INTOLERANCE_KEYS, food.intolerances) };
      await tx.foodIntolerances.upsert({ where: { foodId: food.id }, create: intolerances, update: intolerances });

      const features = { foodId: food.id, ...flagsFrom(FEATURE_KEYS, food.features) };
      await tx.foodFeatures.upsert({ where: { foodId: food.id }, create: features, update: features });

      const diets = { foodId: food.id, ...flagsFrom(DIET_KEYS, food.diets) };
      await tx.foodDiets.upsert({ where: { foodId: food.id }, create: diets, update: diets });
    });
  }

  return { count: SAMPLE_FOODS.length };
};
