import {
  ALLERGEN_KEYS,
  DEFAULT_LANGUAGE,
  DIET_KEYS,
  FEATURE_KEYS,
  INTOLERANCE_KEYS,
  RESTRICTION_KEYS,
  toTagCode,
} from './foodService';
// The label dictionaries themselves live in the dependency-free tag vocabulary, so
// the recommendation ranking can match a user's free-text "avoid this" entries
// against the same localized names without importing a DB-backed service.
import {
  ALLERGEN_LABELS,
  DIET_LABELS,
  FEATURE_LABELS,
  INTOLERANCE_LABELS,
  RESTRICTION_LABELS,
  type LabelDict,
} from '../utils/tagVocabulary';

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
