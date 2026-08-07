/**
 * The fixed tag vocabulary: which boolean columns each `Food*` tag table has, the
 * UPPER_SNAKE code each maps to on the wire, and the display label for each in
 * every supported language.
 *
 * This module is deliberately dependency-free (no Prisma, no env, no services) for
 * two reasons: it is imported by both `foodService` and the recommendation ranking,
 * so a shared home avoids an import cycle; and it lets the ranking logic — which
 * matches a user's free-text "avoid this" entries against these labels, including
 * the safety-critical allergen ones — be unit-tested without a database or a
 * populated `.env`.
 *
 * `foodService` re-exports the key lists and `toTagCode` so its existing importers
 * (admin form options, validation schemas, label service) keep working unchanged.
 */

/** camelCase column key -> language tag -> display label. */
export type LabelDict = Record<string, Record<string, string>>;

// camelCase column name -> UPPER_SNAKE tag code (e.g. treeNuts -> TREE_NUTS).
export const toTagCode = (key: string): string => key.replace(/([A-Z])/g, '_$1').toUpperCase();

// The boolean columns of each tag table, in the order the admin form offers them.
export const ALLERGEN_KEYS = ['milk', 'eggs', 'peanuts', 'treeNuts', 'soy', 'wheat', 'gluten', 'fish', 'shellfish', 'sesame', 'mustard', 'celery', 'lupin', 'molluscs', 'sulfites'];
export const RESTRICTION_KEYS = ['vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher'];
export const INTOLERANCE_KEYS = ['lactose', 'gluten', 'fructose', 'histamine'];
export const FEATURE_KEYS = ['spicy', 'verySpicy', 'lowCarb', 'highProtein', 'lowFat', 'lowCalorie', 'highFiber', 'highSugar', 'highSodium', 'sweet', 'sugarFree'];
export const DIET_KEYS = ['keto', 'paleo', 'mediterranean', 'diabeticFriendly', 'lowGi'];

/** Which tag table a code belongs to — also the Prisma relation name on `Food`. */
export type TagGroup = 'allergens' | 'dietaryRestrictions' | 'intolerances' | 'features' | 'diets';

export const ALLERGEN_LABELS: LabelDict = {
  milk: { en: 'Milk', ru: 'Молоко' },
  eggs: { en: 'Eggs', ru: 'Яйца' },
  peanuts: { en: 'Peanuts', ru: 'Арахис' },
  treeNuts: { en: 'Tree nuts', ru: 'Орехи' },
  soy: { en: 'Soy', ru: 'Соя' },
  wheat: { en: 'Wheat', ru: 'Пшеница' },
  gluten: { en: 'Gluten', ru: 'Глютен' },
  fish: { en: 'Fish', ru: 'Рыба' },
  shellfish: { en: 'Shellfish', ru: 'Ракообразные' },
  sesame: { en: 'Sesame', ru: 'Кунжут' },
  mustard: { en: 'Mustard', ru: 'Горчица' },
  celery: { en: 'Celery', ru: 'Сельдерей' },
  lupin: { en: 'Lupin', ru: 'Люпин' },
  molluscs: { en: 'Molluscs', ru: 'Моллюски' },
  sulfites: { en: 'Sulfites', ru: 'Сульфиты' },
};

export const RESTRICTION_LABELS: LabelDict = {
  vegetarian: { en: 'Vegetarian', ru: 'Вегетарианское' },
  vegan: { en: 'Vegan', ru: 'Веганское' },
  pescatarian: { en: 'Pescatarian', ru: 'Пескетарианское' },
  halal: { en: 'Halal', ru: 'Халяль' },
  kosher: { en: 'Kosher', ru: 'Кошерное' },
};

export const INTOLERANCE_LABELS: LabelDict = {
  lactose: { en: 'Lactose', ru: 'Лактоза' },
  gluten: { en: 'Gluten', ru: 'Глютен' },
  fructose: { en: 'Fructose', ru: 'Фруктоза' },
  histamine: { en: 'Histamine', ru: 'Гистамин' },
};

export const FEATURE_LABELS: LabelDict = {
  spicy: { en: 'Spicy', ru: 'Острое' },
  verySpicy: { en: 'Very spicy', ru: 'Очень острое' },
  lowCarb: { en: 'Low carb', ru: 'Низкоуглеводное' },
  highProtein: { en: 'High protein', ru: 'Высокобелковое' },
  lowFat: { en: 'Low fat', ru: 'Низкожировое' },
  lowCalorie: { en: 'Low calorie', ru: 'Низкокалорийное' },
  highFiber: { en: 'High fiber', ru: 'Богато клетчаткой' },
  highSugar: { en: 'High sugar', ru: 'Много сахара' },
  highSodium: { en: 'High sodium', ru: 'Много натрия' },
  sweet: { en: 'Sweet', ru: 'Сладкое' },
  sugarFree: { en: 'Sugar-free', ru: 'Без сахара' },
};

export const DIET_LABELS: LabelDict = {
  keto: { en: 'Keto', ru: 'Кето' },
  paleo: { en: 'Paleo', ru: 'Палео' },
  mediterranean: { en: 'Mediterranean', ru: 'Средиземноморская' },
  diabeticFriendly: { en: 'Diabetic-friendly', ru: 'Для диабетиков' },
  lowGi: { en: 'Low GI', ru: 'Низкий гликемический индекс' },
};

/** Every tag group paired with its column list and label dictionary. */
export const TAG_GROUPS: { group: TagGroup; keys: string[]; labels: LabelDict }[] = [
  { group: 'allergens', keys: ALLERGEN_KEYS, labels: ALLERGEN_LABELS },
  { group: 'intolerances', keys: INTOLERANCE_KEYS, labels: INTOLERANCE_LABELS },
  { group: 'dietaryRestrictions', keys: RESTRICTION_KEYS, labels: RESTRICTION_LABELS },
  { group: 'diets', keys: DIET_KEYS, labels: DIET_LABELS },
  { group: 'features', keys: FEATURE_KEYS, labels: FEATURE_LABELS },
];
