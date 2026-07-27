import {
  ALLERGEN_KEYS,
  DEFAULT_LANGUAGE,
  DIET_KEYS,
  FEATURE_KEYS,
  INTOLERANCE_KEYS,
  RESTRICTION_KEYS,
  toTagCode,
} from './foodService';

// code (camelCase, matching *_KEYS above) -> language -> display label.
type LabelDict = Record<string, Record<string, string>>;

const ALLERGEN_LABELS: LabelDict = {
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

const RESTRICTION_LABELS: LabelDict = {
  vegetarian: { en: 'Vegetarian', ru: 'Вегетарианское' },
  vegan: { en: 'Vegan', ru: 'Веганское' },
  pescatarian: { en: 'Pescatarian', ru: 'Пескетарианское' },
  halal: { en: 'Halal', ru: 'Халяль' },
  kosher: { en: 'Kosher', ru: 'Кошерное' },
};

const INTOLERANCE_LABELS: LabelDict = {
  lactose: { en: 'Lactose', ru: 'Лактоза' },
  gluten: { en: 'Gluten', ru: 'Глютен' },
  fructose: { en: 'Fructose', ru: 'Фруктоза' },
  histamine: { en: 'Histamine', ru: 'Гистамин' },
};

const FEATURE_LABELS: LabelDict = {
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

const DIET_LABELS: LabelDict = {
  keto: { en: 'Keto', ru: 'Кето' },
  paleo: { en: 'Paleo', ru: 'Палео' },
  mediterranean: { en: 'Mediterranean', ru: 'Средиземноморская' },
  diabeticFriendly: { en: 'Diabetic-friendly', ru: 'Для диабетиков' },
  lowGi: { en: 'Low GI', ru: 'Низкий гликемический индекс' },
};

const resolveLabel = (dict: LabelDict, key: string, lang: string): string =>
  dict[key]?.[lang] ?? dict[key]?.[DEFAULT_LANGUAGE] ?? key;

const labelsFor = (keys: string[], dict: LabelDict, lang: string): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, resolveLabel(dict, k, lang)]));

export interface TagLabels {
  allergens: Record<string, string>;
  dietaryRestrictions: Record<string, string>;
  intolerances: Record<string, string>;
  features: Record<string, string>;
  diets: Record<string, string>;
}

/**
 * Translated display labels for the fixed tag-code catalogs, keyed by the same
 * camelCase key the admin form's option lists (ALLERGEN_KEYS etc.) already use.
 * Falls back to the default language, then the raw code itself, per key — so a
 * key added without a translation yet never renders blank. Backs the
 * admin-client's `/admin/meta/labels`.
 */
export const getTagLabels = (lang: string = DEFAULT_LANGUAGE): TagLabels => ({
  allergens: labelsFor(ALLERGEN_KEYS, ALLERGEN_LABELS, lang),
  dietaryRestrictions: labelsFor(RESTRICTION_KEYS, RESTRICTION_LABELS, lang),
  intolerances: labelsFor(INTOLERANCE_KEYS, INTOLERANCE_LABELS, lang),
  features: labelsFor(FEATURE_KEYS, FEATURE_LABELS, lang),
  diets: labelsFor(DIET_KEYS, DIET_LABELS, lang),
});

/**
 * Same labels, re-keyed to the UPPER_SNAKE tag code a dish's `tags` object
 * actually carries (e.g. "TREE_NUTS") — what Web/Android consume from the
 * public `/catalog/labels` endpoint.
 */
export const getTagLabelsByCode = (lang: string = DEFAULT_LANGUAGE): TagLabels => {
  const byCamelKey = getTagLabels(lang);
  const rekey = (labels: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(labels).map(([key, label]) => [toTagCode(key), label]));
  return {
    allergens: rekey(byCamelKey.allergens),
    dietaryRestrictions: rekey(byCamelKey.dietaryRestrictions),
    intolerances: rekey(byCamelKey.intolerances),
    features: rekey(byCamelKey.features),
    diets: rekey(byCamelKey.diets),
  };
};
