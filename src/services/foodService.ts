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

// Everything shapeFood needs in one include, reused by every read path. Exported
// for the admin food service, which shapes the same rows for CRUD responses.
export const foodInclude = {
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

export const shapeFood = (row: FoodRow): FoodView => ({
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
      'https://picsum.photos/seed/margherita-1/800/600',
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
    images: ['https://picsum.photos/seed/spicy-tuna-1/800/600'],
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
      'https://picsum.photos/seed/tikka-1/800/600',
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
    images: ['https://picsum.photos/seed/buddha-bowl-1/800/600'],
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
      'https://picsum.photos/seed/tacos-1/800/600',
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
    images: ['https://picsum.photos/seed/pad-thai-1/800/600'],
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
    images: ['https://picsum.photos/seed/keto-burger-1/800/600'],
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
      'https://picsum.photos/seed/tiramisu-1/800/600',
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
    images: ['https://picsum.photos/seed/kung-pao-1/800/600'],
    nutrition: { calories: 590, servings: 2, protein: 36, fat: 28, carbs: 40 },
    features: ['spicy', 'highProtein'],
    allergens: ['peanuts', 'soy'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000000a',
    name: 'Mapo Tofu',
    description: 'Silken tofu and minced pork simmered in a fiery Sichuan chili-bean sauce.',
    cuisine: 'CHINESE',
    images: ['https://picsum.photos/seed/mapo-tofu-1/800/600'],
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
    images: ['https://picsum.photos/seed/veg-fried-rice-1/800/600'],
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
    images: ['https://picsum.photos/seed/salmon-nigiri-1/800/600'],
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
    images: ['https://picsum.photos/seed/chicken-ramen-1/800/600'],
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
    images: ['https://picsum.photos/seed/veg-tempura-1/800/600'],
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
    images: ['https://picsum.photos/seed/carne-asada-1/800/600'],
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
    images: ['https://picsum.photos/seed/guacamole-1/800/600'],
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
    images: ['https://picsum.photos/seed/chiles-rellenos-1/800/600'],
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
    images: ['https://picsum.photos/seed/butter-chicken-1/800/600'],
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
    images: ['https://picsum.photos/seed/palak-paneer-1/800/600'],
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
    images: ['https://picsum.photos/seed/chana-masala-1/800/600'],
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
    images: ['https://picsum.photos/seed/lamb-vindaloo-1/800/600'],
    nutrition: { calories: 610, servings: 2, protein: 40, fat: 38, carbs: 18 },
    features: ['verySpicy', 'highProtein', 'lowCarb'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000016',
    name: 'Green Curry Chicken',
    description: 'Coconut-based green curry with chicken, Thai basil, eggplant and bamboo shoots.',
    cuisine: 'THAI',
    images: ['https://picsum.photos/seed/green-curry-1/800/600'],
    nutrition: { calories: 620, servings: 2, protein: 30, fat: 42, carbs: 30 },
    features: ['spicy', 'highProtein'],
    allergens: ['fish'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000017',
    name: 'Tom Yum Goong',
    description: 'Hot and sour shrimp soup with lemongrass, galangal and kaffir lime leaf.',
    cuisine: 'THAI',
    images: ['https://picsum.photos/seed/tom-yum-1/800/600'],
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
    images: ['https://picsum.photos/seed/som-tum-1/800/600'],
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
    images: ['https://picsum.photos/seed/coq-au-vin-1/800/600'],
    nutrition: { calories: 640, servings: 2, protein: 38, fat: 36, carbs: 18 },
    features: ['highProtein'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000001a',
    name: 'French Onion Soup',
    description: 'Caramelized onion soup in beef broth, topped with a toasted baguette and melted Gruyère.',
    cuisine: 'FRENCH',
    images: ['https://picsum.photos/seed/french-onion-soup-1/800/600'],
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
    images: ['https://picsum.photos/seed/ratatouille-1/800/600'],
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
    images: ['https://picsum.photos/seed/creme-brulee-1/800/600'],
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
    images: ['https://picsum.photos/seed/cheeseburger-1/800/600'],
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
    images: ['https://picsum.photos/seed/pulled-pork-1/800/600'],
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
    images: ['https://picsum.photos/seed/mac-and-cheese-1/800/600'],
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
    images: ['https://picsum.photos/seed/cobb-salad-1/800/600'],
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
    images: ['https://picsum.photos/seed/falafel-wrap-1/800/600'],
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
    images: ['https://picsum.photos/seed/greek-salad-1/800/600'],
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
    images: ['https://picsum.photos/seed/branzino-1/800/600'],
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
    images: ['https://picsum.photos/seed/hummus-1/800/600'],
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
    images: ['https://picsum.photos/seed/korean-fried-chicken-1/800/600'],
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
    images: ['https://picsum.photos/seed/bibimbap-1/800/600'],
    nutrition: { calories: 640, servings: 1, protein: 28, fat: 22, carbs: 78 },
    features: ['spicy', 'highFiber'],
    allergens: ['eggs', 'soy', 'sesame'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000027',
    name: 'Kimchi Jjigae',
    description: 'Bubbling kimchi stew with pork belly, tofu and scallion.',
    cuisine: 'KOREAN',
    images: ['https://picsum.photos/seed/kimchi-jjigae-1/800/600'],
    nutrition: { calories: 420, servings: 1, protein: 24, fat: 26, carbs: 20 },
    features: ['verySpicy', 'highProtein'],
    allergens: ['soy'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000028',
    name: 'Japchae',
    description: 'Stir-fried sweet potato glass noodles with vegetables and beef in a soy-sesame glaze.',
    cuisine: 'KOREAN',
    images: ['https://picsum.photos/seed/japchae-1/800/600'],
    nutrition: { calories: 460, servings: 2, protein: 14, fat: 12, carbs: 72 },
    features: ['highSugar'],
    allergens: ['soy', 'sesame'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000029',
    name: 'Spaghetti Carbonara',
    description: 'Egg, pecorino and guanciale tossed with hot pasta and cracked black pepper.',
    cuisine: 'ITALIAN',
    images: ['https://picsum.photos/seed/carbonara-1/800/600'],
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
    images: ['https://picsum.photos/seed/mushroom-risotto-1/800/600'],
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
    images: ['https://picsum.photos/seed/caprese-1/800/600'],
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
    images: ['https://picsum.photos/seed/bulgogi-1/800/600'],
    nutrition: { calories: 620, servings: 2, protein: 34, fat: 26, carbs: 56 },
    features: ['highProtein', 'highSugar'],
    allergens: ['soy', 'sesame'],
  },
  {
    id: 'f0000000-0000-4000-8000-00000000002d',
    name: 'Shrimp Tempura Udon',
    description: 'Thick wheat noodles in dashi broth topped with crispy shrimp tempura.',
    cuisine: 'JAPANESE',
    images: ['https://picsum.photos/seed/tempura-udon-1/800/600'],
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
    images: ['https://picsum.photos/seed/elote-1/800/600'],
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
    images: ['https://picsum.photos/seed/pho-1/800/600'],
    nutrition: { calories: 480, servings: 1, protein: 28, fat: 12, carbs: 62 },
    features: ['lowFat'],
    allergens: ['fish'],
  },
  {
    id: 'f0000000-0000-4000-8000-000000000030',
    name: 'Lentil Soup',
    description: 'Hearty red lentil soup with cumin, carrot and a squeeze of lemon.',
    cuisine: 'MEDITERRANEAN',
    images: ['https://picsum.photos/seed/lentil-soup-1/800/600'],
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
    images: ['https://picsum.photos/seed/waffle-1/800/600'],
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
    images: ['https://picsum.photos/seed/shakshuka-1/800/600'],
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
