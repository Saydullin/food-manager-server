import { Prisma, type FoodDislikeReason, type FoodInteractionAction } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { decodeCursor, encodeCursor } from '../utils/cursor';
import { pickByLanguage } from '../utils/i18n';
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

// The language a dish is translated into, when a client requests it. The dish
// catalog isn't restricted to this list (any BCP-47 tag can be stored), but
// this is the set the admin panel offers by default.
export const SUPPORTED_LANGUAGES = ['en', 'ru'];

// The fallback language used when a client doesn't ask for one, or asks for
// one a dish hasn't been translated into. Mirrors UserSettings.language's default.
export const DEFAULT_LANGUAGE = 'en';

export interface FoodTranslationView {
  language: string;
  name: string;
  description: string | null;
  content: string | null;
}

// One ingredient line on a recipe: the catalog ingredient's id/name plus how
// much of it this recipe uses. `name` resolves to the requested language, same
// fallback rule as the dish's own name/description/content.
export interface FoodIngredientView {
  id: string;
  ingredientId: string;
  name: string;
  amount: number;
  unit: string;
}

// The admin-panel shape for an ingredient line: every translation the catalog
// ingredient has, rather than one resolved language, so the admin-client can
// tell which languages are missing without a second round trip.
export interface AdminFoodIngredientView extends FoodIngredientView {
  translations: { language: string; name: string }[];
}

export interface FoodView {
  id: string;
  name: string;
  description: string | null;
  content: string | null;
  // The language the name/description/content above actually resolved to —
  // may differ from the language requested if that translation didn't exist.
  language: string;
  availableLanguages: string[];
  cuisine: string | null;
  images: string[];
  nutrition: FoodNutritionView | null;
  tags: FoodTags;
  ingredients: FoodIngredientView[];
  createdAt: Date;
  updatedAt: Date;
}

// The admin-panel shape: every translation, rather than one resolved language,
// since admins author/edit all of them at once.
export interface AdminFoodView
  extends Omit<FoodView, 'name' | 'description' | 'content' | 'language' | 'availableLanguages' | 'ingredients'> {
  translations: FoodTranslationView[];
  ingredients: AdminFoodIngredientView[];
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

// Everything shapeFood needs in one include, reused by every read path. Exported
// for the admin food service, which shapes the same rows for CRUD responses.
export const foodInclude = {
  cuisine: { select: { code: true } },
  images: { select: { url: true }, orderBy: { position: 'asc' } },
  translations: { select: { language: true, name: true, description: true, content: true } },
  nutrition: true,
  allergens: true,
  dietaryRestrictions: true,
  intolerances: true,
  features: true,
  diets: true,
  ingredients: {
    select: {
      id: true,
      ingredientId: true,
      amount: true,
      unit: true,
      ingredient: { select: { translations: { select: { language: true, name: true } } } },
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.FoodInclude;

type FoodRow = Prisma.FoodGetPayload<{ include: typeof foodInclude }>;

// camelCase column name -> UPPER_SNAKE tag code (e.g. treeNuts -> TREE_NUTS).
// Exported for labelService, which needs the same mapping to key its public
// (Web/Android-facing) label dictionary by the codes clients actually receive.
export const toTagCode = (key: string): string => key.replace(/([A-Z])/g, '_$1').toUpperCase();

// Flattens a boolean tag row (e.g. FoodAllergens) into the codes whose column is
// true, ignoring the non-boolean `foodId` key. A null row (no tags recorded) -> [].
const trueTags = (row: Record<string, unknown> | null): string[] =>
  row
    ? Object.entries(row)
        .filter(([, value]) => value === true)
        .map(([key]) => toTagCode(key))
    : [];

const sharedFoodFields = (row: FoodRow) => ({
  id: row.id,
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

export const shapeFood = (row: FoodRow, lang: string = DEFAULT_LANGUAGE): FoodView => {
  const translation = pickByLanguage(row.translations, lang, DEFAULT_LANGUAGE);
  return {
    ...sharedFoodFields(row),
    name: translation?.name ?? '',
    description: translation?.description ?? null,
    content: translation?.content ?? null,
    language: translation?.language ?? DEFAULT_LANGUAGE,
    availableLanguages: row.translations.map((t) => t.language),
    ingredients: row.ingredients.map((i) => ({
      id: i.id,
      ingredientId: i.ingredientId,
      name: pickByLanguage(i.ingredient.translations, lang, DEFAULT_LANGUAGE)?.name ?? '',
      amount: i.amount,
      unit: i.unit,
    })),
  };
};

// The admin-panel shape: all translations at once, rather than one resolved
// language, since admins author/edit every language in the same form. Each
// ingredient line likewise carries every translation it has (not just one
// resolved name), so the admin-client can tell which languages are missing.
export const shapeFoodAdmin = (row: FoodRow): AdminFoodView => ({
  ...sharedFoodFields(row),
  translations: row.translations
    .map((t) => ({ language: t.language, name: t.name, description: t.description, content: t.content }))
    .sort((a, b) => a.language.localeCompare(b.language)),
  ingredients: row.ingredients.map((i) => ({
    id: i.id,
    ingredientId: i.ingredientId,
    name: pickByLanguage(i.ingredient.translations, DEFAULT_LANGUAGE, DEFAULT_LANGUAGE)?.name ?? '',
    amount: i.amount,
    unit: i.unit,
    translations: i.ingredient.translations,
  })),
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
  lang?: string;
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
export const getFeed = async (
  userId: string,
  { limit, cursor, lang = DEFAULT_LANGUAGE }: FeedParams,
): Promise<Page<FoodView>> => {
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

  return toPage(rows, limit, (r) => ({ createdAt: r.createdAt, id: r.id }), (r) => shapeFood(r, lang));
};

/** Full detail for a single dish. 404s if it doesn't exist. */
export const getFood = async (foodId: string, lang: string = DEFAULT_LANGUAGE): Promise<FoodView> => {
  const row = await prisma.food.findUnique({ where: { id: foodId }, include: foodInclude });
  if (!row) throw AppError.notFound('Food not found', 'FOOD_NOT_FOUND');
  return shapeFood(row, lang);
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

  // The reasonDetail is the concrete thing the user is rejecting (e.g. a tag or
  // cuisine code), same shape as UserFoodException.value — feed it in so the
  // recommender (and the user's own profile view) picks up the dislike without
  // the client having to separately call the food-exceptions endpoint.
  if (reasonDetail) {
    const value = reasonDetail.trim().toLowerCase();
    await prisma.userFoodException.upsert({
      where: { userId_value: { userId, value } },
      create: { userId, value },
      update: {},
    });
  }

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
  lang?: string;
}

/**
 * The user's own swipe history ("my likes / dislikes"), optionally filtered to one
 * action, newest first, keyset-paginated by the interaction's `(createdAt, id)`.
 * Each entry carries the full dish so a client can render the list without a second
 * round-trip.
 */
export const listInteractions = async (
  userId: string,
  { action, limit, cursor, lang = DEFAULT_LANGUAGE }: ListInteractionsParams,
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
    (r) => ({ ...shapeInteraction(r), food: shapeFood(r.food, lang) }),
  );
};

// Trims a fetched `limit + 1` slice into a page: drops the probe row, computes
// hasMore, and builds nextCursor from the last kept row's keyset. Exported for
// the admin food list, which pages the same way.
export const toPage = <TRow, TOut>(
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
      'https://www.themealdb.com/images/media/meals/x0lk931587671540.jpg',
      'https://picsum.photos/seed/margherita-2/800/600',
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
    images: ['https://www.themealdb.com/images/media/meals/ustsqw1468250014.jpg'],
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
      'https://www.themealdb.com/images/media/meals/wyxwsp1486979827.jpg',
      'https://picsum.photos/seed/tikka-2/800/600',
      'https://picsum.photos/seed/tikka-3/800/600',
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
    images: ['https://www.themealdb.com/images/media/meals/rvxxuy1468312893.jpg'],
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
      'https://www.themealdb.com/images/media/meals/pbzcrx1763765096.jpg',
      'https://picsum.photos/seed/tacos-2/800/600',
    ],
    nutrition: { calories: 700, servings: 3, protein: 38, fat: 34, carbs: 58 },
    features: ['spicy', 'highProtein'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000006',
    name: 'Pad Thai',
    description: 'Stir-fried rice noodles with shrimp, egg, peanuts and tamarind sauce.',
    cuisine: 'THAI',
    images: ['https://www.themealdb.com/images/media/meals/rg9ze01763479093.jpg'],
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
    images: ['https://www.themealdb.com/images/media/meals/8wynv41782686271.jpg'],
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
      'https://www.themealdb.com/images/media/meals/vvtvtr1511180578.jpg',
      'https://picsum.photos/seed/tiramisu-2/800/600',
    ],
    nutrition: { calories: 450, servings: 4, protein: 8, fat: 26, carbs: 42 },
    features: ['sweet', 'highSugar'],
    allergens: ['milk', 'eggs', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000009',
    name: 'Kung Pao Chicken',
    description: 'Wok-fried chicken with peanuts, dried chilies and scallion in a savory-sweet sauce.',
    cuisine: 'CHINESE',
    images: ['https://www.themealdb.com/images/media/meals/1525872624.jpg'],
    nutrition: { calories: 590, servings: 2, protein: 36, fat: 28, carbs: 40 },
    features: ['spicy', 'highProtein'],
    allergens: ['peanuts', 'soy'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000000a',
    name: 'Mapo Tofu',
    description: 'Silken tofu and minced pork simmered in a fiery Sichuan chili-bean sauce.',
    cuisine: 'CHINESE',
    images: ['https://www.themealdb.com/images/media/meals/wuyd2h1765655837.jpg'],
    nutrition: { calories: 420, servings: 2, protein: 22, fat: 26, carbs: 20 },
    features: ['verySpicy', 'highProtein'],
    allergens: ['soy'],
    dietaryRestrictions: [],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000000b',
    name: 'Vegetable Fried Rice',
    description: 'Day-old rice wok-tossed with egg, carrot, peas and soy sauce.',
    cuisine: 'CHINESE',
    images: ['https://www.themealdb.com/images/media/meals/w8umt11583268117.jpg'],
    nutrition: { calories: 480, servings: 2, protein: 12, fat: 14, carbs: 76 },
    features: ['lowFat'],
    allergens: ['eggs', 'soy'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000000c',
    name: 'Salmon Nigiri Set',
    description: 'Hand-pressed sushi rice topped with fresh salmon, eight pieces.',
    cuisine: 'JAPANESE',
    images: ['https://www.themealdb.com/images/media/meals/ikizdm1763760862.jpg'],
    nutrition: { calories: 380, servings: 1, protein: 28, fat: 10, carbs: 46 },
    features: ['highProtein', 'lowFat'],
    allergens: ['fish', 'soy'],
    dietaryRestrictions: ['pescatarian'],
    diets: ['lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000000d',
    name: 'Chicken Ramen',
    description: 'Rich shoyu broth with braised chicken, soft egg, nori and scallion.',
    cuisine: 'JAPANESE',
    images: ['https://www.themealdb.com/images/media/meals/wyxwsp1486979827.jpg'],
    nutrition: { calories: 720, servings: 1, protein: 34, fat: 22, carbs: 90 },
    features: ['highSodium'],
    allergens: ['eggs', 'wheat', 'gluten', 'soy'],
    intolerances: ['gluten'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000000e',
    name: 'Vegetable Tempura',
    description: 'Lightly battered and fried seasonal vegetables with dipping sauce.',
    cuisine: 'JAPANESE',
    images: ['https://www.themealdb.com/images/media/meals/w8umt11583268117.jpg'],
    nutrition: { calories: 410, servings: 2, protein: 8, fat: 20, carbs: 48 },
    features: ['highSugar'],
    allergens: ['wheat', 'gluten', 'eggs'],
    intolerances: ['gluten'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000000f',
    name: 'Carne Asada Burrito',
    description: 'Grilled marinated steak, rice, beans and pico de gallo wrapped in a flour tortilla.',
    cuisine: 'MEXICAN',
    images: ['https://www.themealdb.com/images/media/meals/uuqvwu1504629254.jpg'],
    nutrition: { calories: 780, servings: 1, protein: 42, fat: 30, carbs: 82 },
    features: ['highProtein', 'highSodium'],
    allergens: ['wheat', 'gluten', 'milk'],
    intolerances: ['gluten', 'lactose'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000010',
    name: 'Guacamole & Chips',
    description: 'Fresh-mashed avocado with lime, onion, cilantro and tortilla chips.',
    cuisine: 'MEXICAN',
    images: ['https://www.themealdb.com/images/media/meals/uvuyxu1503067369.jpg'],
    nutrition: { calories: 460, servings: 2, protein: 6, fat: 32, carbs: 42 },
    features: ['highFiber'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
    diets: ['paleo'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000011',
    name: 'Chiles Rellenos',
    description: 'Roasted poblano peppers stuffed with cheese, battered and fried, in tomato sauce.',
    cuisine: 'MEXICAN',
    images: ['https://www.themealdb.com/images/media/meals/qtuwxu1468233098.jpg'],
    nutrition: { calories: 540, servings: 2, protein: 20, fat: 36, carbs: 32 },
    features: ['spicy'],
    allergens: ['milk', 'eggs', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000012',
    name: 'Butter Chicken',
    description: 'Tandoori chicken simmered in a velvety tomato-butter-cream sauce.',
    cuisine: 'INDIAN',
    images: ['https://www.themealdb.com/images/media/meals/l6hj9a1784668199.jpg'],
    nutrition: { calories: 680, servings: 2, protein: 38, fat: 44, carbs: 30 },
    features: ['highProtein'],
    allergens: ['milk'],
    intolerances: ['lactose'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000013',
    name: 'Palak Paneer',
    description: 'Fresh spinach curry with cubes of homemade paneer cheese.',
    cuisine: 'INDIAN',
    images: ['https://www.themealdb.com/images/media/meals/xjii2g1784836867.jpg'],
    nutrition: { calories: 480, servings: 2, protein: 22, fat: 34, carbs: 20 },
    features: ['highFiber'],
    allergens: ['milk'],
    intolerances: ['lactose'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000014',
    name: 'Chana Masala',
    description: 'Chickpeas simmered in a tangy tomato-onion masala with ginger and garam masala.',
    cuisine: 'INDIAN',
    images: ['https://www.themealdb.com/images/media/meals/tvtxpq1511464705.jpg'],
    nutrition: { calories: 420, servings: 2, protein: 16, fat: 12, carbs: 60 },
    features: ['highFiber', 'lowFat'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
    diets: ['lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000015',
    name: 'Lamb Vindaloo',
    description: 'Slow-cooked lamb in a fiery vinegar-and-chili Goan curry.',
    cuisine: 'INDIAN',
    images: ['https://www.themealdb.com/images/media/meals/yuwtuu1511295751.jpg'],
    nutrition: { calories: 610, servings: 2, protein: 40, fat: 38, carbs: 18 },
    features: ['verySpicy', 'highProtein', 'lowCarb'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000016',
    name: 'Green Curry Chicken',
    description: 'Coconut-based green curry with chicken, Thai basil, eggplant and bamboo shoots.',
    cuisine: 'THAI',
    images: ['https://www.themealdb.com/images/media/meals/sstssx1487349585.jpg'],
    nutrition: { calories: 620, servings: 2, protein: 30, fat: 42, carbs: 30 },
    features: ['spicy', 'highProtein'],
    allergens: ['fish'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000017',
    name: 'Tom Yum Goong',
    description: 'Hot and sour shrimp soup with lemongrass, galangal and kaffir lime leaf.',
    cuisine: 'THAI',
    images: ['https://www.themealdb.com/images/media/meals/l50vz41763422681.jpg'],
    nutrition: { calories: 240, servings: 1, protein: 20, fat: 8, carbs: 22 },
    features: ['spicy', 'lowFat', 'lowCalorie'],
    allergens: ['shellfish', 'fish'],
    dietaryRestrictions: ['pescatarian'],
    diets: ['lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000018',
    name: 'Som Tum (Papaya Salad)',
    description: 'Shredded green papaya, tomato, peanut and chili tossed in a tangy lime dressing.',
    cuisine: 'THAI',
    images: ['https://www.themealdb.com/images/media/meals/44pjrn1779814409.jpg'],
    nutrition: { calories: 180, servings: 1, protein: 5, fat: 6, carbs: 28 },
    features: ['spicy', 'lowCalorie', 'lowFat'],
    allergens: ['peanuts', 'fish', 'shellfish'],
    dietaryRestrictions: ['pescatarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000019',
    name: 'Coq au Vin',
    description: 'Chicken braised slowly in red wine with mushrooms, pearl onions and bacon.',
    cuisine: 'FRENCH',
    images: ['https://www.themealdb.com/images/media/meals/qstyvs1505931190.jpg'],
    nutrition: { calories: 640, servings: 2, protein: 38, fat: 36, carbs: 18 },
    features: ['highProtein'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000001a',
    name: 'French Onion Soup',
    description: 'Caramelized onion soup in beef broth, topped with a toasted baguette and melted Gruyère.',
    cuisine: 'FRENCH',
    images: ['https://www.themealdb.com/images/media/meals/xvrrux1511783685.jpg'],
    nutrition: { calories: 380, servings: 1, protein: 14, fat: 20, carbs: 34 },
    features: [],
    allergens: ['milk', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000001b',
    name: 'Ratatouille',
    description: 'Provençal stew of eggplant, zucchini, bell pepper and tomato simmered with herbs.',
    cuisine: 'FRENCH',
    images: ['https://www.themealdb.com/images/media/meals/wrpwuu1511786491.jpg'],
    nutrition: { calories: 220, servings: 2, protein: 6, fat: 10, carbs: 30 },
    features: ['lowCalorie', 'highFiber'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
    diets: ['mediterranean', 'paleo', 'lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000001c',
    name: 'Crème Brûlée',
    description: 'Vanilla custard with a torched sugar crust.',
    cuisine: 'FRENCH',
    images: ['https://www.themealdb.com/images/media/meals/uryqru1511798039.jpg'],
    nutrition: { calories: 400, servings: 2, protein: 6, fat: 28, carbs: 32 },
    features: ['sweet', 'highSugar'],
    allergens: ['milk', 'eggs'],
    intolerances: ['lactose'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000001d',
    name: 'Classic Cheeseburger',
    description: 'Beef patty, cheddar, lettuce, tomato and pickles on a brioche bun.',
    cuisine: 'AMERICAN',
    images: ['https://www.themealdb.com/images/media/meals/0sd7ac1764787957.jpg'],
    nutrition: { calories: 750, servings: 1, protein: 38, fat: 42, carbs: 52 },
    features: ['highProtein', 'highSodium'],
    allergens: ['milk', 'wheat', 'gluten', 'eggs'],
    intolerances: ['lactose', 'gluten'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000001e',
    name: 'BBQ Pulled Pork Sandwich',
    description: 'Slow-smoked pork shoulder tossed in tangy BBQ sauce, piled on a soft bun.',
    cuisine: 'AMERICAN',
    images: ['https://www.themealdb.com/images/media/meals/atd5sh1583188467.jpg'],
    nutrition: { calories: 720, servings: 1, protein: 36, fat: 28, carbs: 74 },
    features: ['highProtein', 'highSugar'],
    allergens: ['wheat', 'gluten'],
    intolerances: ['gluten'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000001f',
    name: 'Mac and Cheese',
    description: 'Elbow macaroni baked in a rich three-cheese sauce with a crisp breadcrumb top.',
    cuisine: 'AMERICAN',
    images: ['https://www.themealdb.com/images/media/meals/qrqywr1503066605.jpg'],
    nutrition: { calories: 620, servings: 2, protein: 22, fat: 30, carbs: 64 },
    features: ['highSodium'],
    allergens: ['milk', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000020',
    name: 'Cobb Salad',
    description: 'Chopped lettuce with grilled chicken, bacon, egg, avocado, blue cheese and tomato.',
    cuisine: 'AMERICAN',
    images: ['https://www.themealdb.com/images/media/meals/1525872624.jpg'],
    nutrition: { calories: 560, servings: 1, protein: 36, fat: 40, carbs: 14 },
    features: ['lowCarb', 'highProtein'],
    allergens: ['milk', 'eggs'],
    intolerances: ['lactose'],
    diets: ['keto'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000021',
    name: 'Falafel Wrap',
    description: 'Crispy chickpea fritters with tahini, pickled turnip and greens in flatbread.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://www.themealdb.com/images/media/meals/u5e9qq1763795441.jpg'],
    nutrition: { calories: 520, servings: 1, protein: 18, fat: 22, carbs: 62 },
    features: ['highFiber'],
    allergens: ['sesame', 'wheat', 'gluten'],
    intolerances: ['gluten'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
    diets: ['mediterranean'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000022',
    name: 'Greek Salad',
    description: 'Cucumber, tomato, red onion, kalamata olives and feta with oregano and olive oil.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://www.themealdb.com/images/media/meals/k29viq1585565980.jpg'],
    nutrition: { calories: 320, servings: 1, protein: 9, fat: 26, carbs: 14 },
    features: ['lowCarb', 'lowCalorie'],
    allergens: ['milk'],
    intolerances: ['lactose'],
    dietaryRestrictions: ['vegetarian'],
    diets: ['mediterranean', 'keto', 'lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000023',
    name: 'Grilled Branzino',
    description: 'Whole Mediterranean sea bass grilled with lemon, garlic and rosemary.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://www.themealdb.com/images/media/meals/lpd4wy1614347943.jpg'],
    nutrition: { calories: 380, servings: 1, protein: 44, fat: 20, carbs: 4 },
    features: ['lowCarb', 'highProtein'],
    allergens: ['fish'],
    dietaryRestrictions: ['pescatarian'],
    diets: ['mediterranean', 'keto', 'paleo'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000024',
    name: 'Hummus & Pita',
    description: 'Silky chickpea-tahini hummus drizzled with olive oil, served with warm pita.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://www.themealdb.com/images/media/meals/gpon5u1763801180.jpg'],
    nutrition: { calories: 380, servings: 2, protein: 12, fat: 16, carbs: 48 },
    features: ['highFiber'],
    allergens: ['sesame', 'wheat', 'gluten'],
    intolerances: ['gluten'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
    diets: ['mediterranean'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000025',
    name: 'Korean Fried Chicken',
    description: 'Double-fried chicken glazed in a sticky-sweet gochujang sauce, sesame seed garnish.',
    cuisine: 'KOREAN',
    images: ['https://www.themealdb.com/images/media/meals/0dhtwr1763371444.jpg'],
    nutrition: { calories: 780, servings: 2, protein: 40, fat: 44, carbs: 54 },
    features: ['spicy', 'highSugar', 'highProtein'],
    allergens: ['soy', 'sesame', 'wheat', 'gluten'],
    intolerances: ['gluten'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000026',
    name: 'Bibimbap',
    description: 'Rice bowl with sautéed vegetables, marinated beef, a fried egg and gochujang.',
    cuisine: 'KOREAN',
    images: ['https://www.themealdb.com/images/media/meals/q8sp3j1593349686.jpg'],
    nutrition: { calories: 640, servings: 1, protein: 28, fat: 22, carbs: 78 },
    features: ['spicy', 'highFiber'],
    allergens: ['eggs', 'soy', 'sesame'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000027',
    name: 'Kimchi Jjigae',
    description: 'Bubbling kimchi stew with pork belly, tofu and scallion.',
    cuisine: 'KOREAN',
    images: ['https://www.themealdb.com/images/media/meals/g80f4t1782690273.jpg'],
    nutrition: { calories: 420, servings: 1, protein: 24, fat: 26, carbs: 20 },
    features: ['verySpicy', 'highProtein'],
    allergens: ['soy'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000028',
    name: 'Japchae',
    description: 'Stir-fried sweet potato glass noodles with vegetables and beef in a soy-sesame glaze.',
    cuisine: 'KOREAN',
    images: ['https://www.themealdb.com/images/media/meals/xxpqsy1511452222.jpg'],
    nutrition: { calories: 460, servings: 2, protein: 14, fat: 12, carbs: 72 },
    features: ['highSugar'],
    allergens: ['soy', 'sesame'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000029',
    name: 'Spaghetti Carbonara',
    description: 'Egg, pecorino and guanciale tossed with hot pasta and cracked black pepper.',
    cuisine: 'ITALIAN',
    images: ['https://www.themealdb.com/images/media/meals/5fu4ew1760524857.jpg'],
    nutrition: { calories: 720, servings: 2, protein: 30, fat: 34, carbs: 72 },
    features: ['highSodium'],
    allergens: ['eggs', 'milk', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000002a',
    name: 'Mushroom Risotto',
    description: 'Creamy Arborio rice slow-cooked with wild mushrooms, white wine and parmesan.',
    cuisine: 'ITALIAN',
    images: ['https://www.themealdb.com/images/media/meals/0r7y5n1782681336.jpg'],
    nutrition: { calories: 560, servings: 2, protein: 14, fat: 20, carbs: 76 },
    features: ['highSodium'],
    allergens: ['milk'],
    intolerances: ['lactose'],
    dietaryRestrictions: ['vegetarian'],
    diets: ['mediterranean'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000002b',
    name: 'Caprese Salad',
    description: 'Sliced tomato and fresh mozzarella layered with basil and a balsamic drizzle.',
    cuisine: 'ITALIAN',
    images: ['https://www.themealdb.com/images/media/meals/wwuqvt1487345467.jpg'],
    nutrition: { calories: 280, servings: 1, protein: 14, fat: 20, carbs: 10 },
    features: ['lowCarb', 'lowCalorie'],
    allergens: ['milk'],
    intolerances: ['lactose'],
    dietaryRestrictions: ['vegetarian'],
    diets: ['mediterranean', 'keto', 'lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000002c',
    name: 'Beef Bulgogi',
    description: 'Thinly sliced marinated ribeye grilled and served over rice.',
    cuisine: 'KOREAN',
    images: ['https://www.themealdb.com/images/media/meals/pbzcrx1763765096.jpg'],
    nutrition: { calories: 620, servings: 2, protein: 34, fat: 26, carbs: 56 },
    features: ['highProtein', 'highSugar'],
    allergens: ['soy', 'sesame'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000002d',
    name: 'Shrimp Tempura Udon',
    description: 'Thick wheat noodles in dashi broth topped with crispy shrimp tempura.',
    cuisine: 'JAPANESE',
    images: ['https://www.themealdb.com/images/media/meals/1529445434.jpg'],
    nutrition: { calories: 680, servings: 1, protein: 26, fat: 20, carbs: 96 },
    features: ['highSodium'],
    allergens: ['shellfish', 'wheat', 'gluten', 'eggs', 'soy'],
    intolerances: ['gluten'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000002e',
    name: 'Elote (Mexican Street Corn)',
    description: 'Grilled corn on the cob slathered in crema, cotija cheese, chili powder and lime.',
    cuisine: 'MEXICAN',
    images: ['https://www.themealdb.com/images/media/meals/uvuyxu1503067369.jpg'],
    nutrition: { calories: 340, servings: 1, protein: 8, fat: 20, carbs: 34 },
    features: ['spicy'],
    allergens: ['milk'],
    intolerances: ['lactose'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000002f',
    name: 'Pho Bo',
    description: 'Vietnamese-style beef noodle soup with star anise broth, herbs and bean sprouts.',
    cuisine: 'THAI',
    images: ['https://www.themealdb.com/images/media/meals/pbzcrx1763765096.jpg'],
    nutrition: { calories: 480, servings: 1, protein: 28, fat: 12, carbs: 62 },
    features: ['lowFat'],
    allergens: ['fish'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000030',
    name: 'Lentil Soup',
    description: 'Hearty red lentil soup with cumin, carrot and a squeeze of lemon.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://www.themealdb.com/images/media/meals/vpxyqt1511464175.jpg'],
    nutrition: { calories: 280, servings: 2, protein: 16, fat: 6, carbs: 42 },
    features: ['highFiber', 'lowFat', 'lowCalorie'],
    dietaryRestrictions: ['vegetarian', 'vegan'],
    diets: ['mediterranean', 'lowGi'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000031',
    name: 'Belgian Waffle',
    description: 'Deep-pocketed waffle with whipped cream, berries and maple syrup.',
    cuisine: 'AMERICAN',
    images: ['https://www.themealdb.com/images/media/meals/byolko1782500400.jpg'],
    nutrition: { calories: 560, servings: 1, protein: 10, fat: 22, carbs: 78 },
    features: ['sweet', 'highSugar'],
    allergens: ['milk', 'eggs', 'wheat', 'gluten'],
    intolerances: ['lactose', 'gluten'],
    dietaryRestrictions: ['vegetarian'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000032',
    name: 'Shakshuka',
    description: 'Eggs poached in a spiced tomato and bell pepper sauce, served with crusty bread.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://www.themealdb.com/images/media/meals/g373701551450225.jpg'],
    nutrition: { calories: 380, servings: 1, protein: 18, fat: 22, carbs: 28 },
    features: ['spicy', 'highProtein'],
    allergens: ['eggs', 'wheat', 'gluten'],
    intolerances: ['gluten'],
    dietaryRestrictions: ['vegetarian'],
    diets: ['mediterranean', 'lowGi'],
  },
];

// Builds the boolean-column object for a tag table from the list of true codes.
// Exported so the admin food service builds the same shape from request tag codes.
export const flagsFrom = (keys: string[], on: string[] | undefined): Record<string, boolean> =>
  Object.fromEntries(keys.map((k) => [k, (on ?? []).includes(k)]));

// The valid camelCase column keys for each tag table — the source of truth for
// which codes a client may send (converted to UPPER_SNAKE by toTagCode for reads).
// Exported for the admin food validation schema and seeding, so both stay in sync
// with the actual Prisma columns without redeclaring the lists.
export const ALLERGEN_KEYS = ['milk', 'eggs', 'peanuts', 'treeNuts', 'soy', 'wheat', 'gluten', 'fish', 'shellfish', 'sesame', 'mustard', 'celery', 'lupin', 'molluscs', 'sulfites'];
export const RESTRICTION_KEYS = ['vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher'];
export const INTOLERANCE_KEYS = ['lactose', 'gluten', 'fructose', 'histamine'];
export const FEATURE_KEYS = ['spicy', 'verySpicy', 'lowCarb', 'highProtein', 'lowFat', 'lowCalorie', 'highFiber', 'highSugar', 'highSodium', 'sweet', 'sugarFree'];
export const DIET_KEYS = ['keto', 'paleo', 'mediterranean', 'diabeticFriendly', 'lowGi'];

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
    const base = { cuisineId };

    await prisma.$transaction(async (tx) => {
      await tx.food.upsert({ where: { id: food.id }, create: { id: food.id, ...base }, update: base });

      const translation = { foodId: food.id, language: DEFAULT_LANGUAGE, name: food.name, description: food.description };
      await tx.foodTranslation.upsert({
        where: { foodId_language: { foodId: food.id, language: DEFAULT_LANGUAGE } },
        create: translation,
        update: translation,
      });

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
