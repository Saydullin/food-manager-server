import { useState } from 'react';
import { uploadImage } from '../lib/api';
import type { Food, FoodFormOptions } from '../lib/types';
import { ArticleEditor } from './ArticleEditor';
import { IngredientsEditor, type IngredientLine } from './IngredientsEditor';

// Must match DEFAULT_LANGUAGE in src/services/foodService.ts — every dish
// needs a translation in this language; nothing else can fall back past it.
export const DEFAULT_LANGUAGE = 'en';

export interface FoodFormValues {
  // Keyed by language code (e.g. "en", "ru"). Only languages with a non-empty
  // name are sent as translations on submit. `content` is the recipe article
  // body (HTML from the rich-text editor).
  translations: Record<string, { name: string; description: string; content: string }>;
  cuisineCode: string;
  images: string[];
  nutrition: { calories: string; servings: string; protein: string; fat: string; carbs: string };
  allergens: string[];
  dietaryRestrictions: string[];
  intolerances: string[];
  features: string[];
  diets: string[];
  // Language-agnostic, like nutrition/tags — one ingredient list for the recipe.
  ingredients: IngredientLine[];
}

export function emptyFoodForm(): FoodFormValues {
  return {
    translations: { [DEFAULT_LANGUAGE]: { name: '', description: '', content: '' } },
    cuisineCode: '',
    images: [],
    nutrition: { calories: '', servings: '', protein: '', fat: '', carbs: '' },
    allergens: [],
    dietaryRestrictions: [],
    intolerances: [],
    features: [],
    diets: [],
    ingredients: [],
  };
}

export function foodToFormValues(food: Food): FoodFormValues {
  const translations: FoodFormValues['translations'] = {};
  for (const t of food.translations) {
    translations[t.language] = { name: t.name, description: t.description ?? '', content: t.content ?? '' };
  }
  if (!translations[DEFAULT_LANGUAGE]) {
    translations[DEFAULT_LANGUAGE] = { name: '', description: '', content: '' };
  }

  return {
    translations,
    cuisineCode: food.cuisine ?? '',
    images: food.images,
    nutrition: {
      calories: food.nutrition?.calories?.toString() ?? '',
      servings: food.nutrition?.servings?.toString() ?? '',
      protein: food.nutrition?.protein?.toString() ?? '',
      fat: food.nutrition?.fat?.toString() ?? '',
      carbs: food.nutrition?.carbs?.toString() ?? '',
    },
    allergens: toCamelList(food.tags.allergens),
    dietaryRestrictions: toCamelList(food.tags.dietaryRestrictions),
    intolerances: toCamelList(food.tags.intolerances),
    features: toCamelList(food.tags.features),
    diets: toCamelList(food.tags.diets),
    ingredients: food.ingredients.map((i) => ({
      key: i.id,
      ingredientId: i.ingredientId,
      name: i.name,
      amount: i.amount.toString(),
      unit: i.unit,
    })),
  };
}

// The read side returns UPPER_SNAKE codes (e.g. TREE_NUTS); the write side takes
// the camelCase column keys (treeNuts) the form options list uses.
const toCamelList = (codes: string[]): string[] =>
  codes.map((c) => c.toLowerCase().replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase()));

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

// Whether the form has enough content to submit: the default language's name
// is required (mirrors the server's "translations must include the default
// language" rule), other languages are optional.
export function isFoodFormValid(values: FoodFormValues): boolean {
  return (values.translations[DEFAULT_LANGUAGE]?.name ?? '').trim() !== '';
}

export function formValuesToPayload(values: FoodFormValues) {
  const nutritionEntries = Object.entries(values.nutrition).some(([, v]) => v.trim() !== '');
  const translations = Object.entries(values.translations)
    .filter(([, t]) => t.name.trim() !== '')
    .map(([language, t]) => ({
      language,
      name: t.name.trim(),
      description: t.description.trim() === '' ? null : t.description,
      content: t.content.trim() === '' ? null : t.content,
    }));

  // Drop incomplete rows (no name, or an amount that doesn't parse to a
  // positive number) rather than sending something the server would reject.
  const ingredients = values.ingredients
    .filter((line) => line.name.trim() !== '' && num(line.amount) !== null && num(line.amount)! > 0)
    .map((line) => ({
      ...(line.ingredientId ? { ingredientId: line.ingredientId } : { name: line.name.trim() }),
      amount: num(line.amount)!,
      unit: line.unit,
    }));

  return {
    translations,
    cuisineCode: values.cuisineCode === '' ? null : values.cuisineCode,
    images: values.images,
    ...(nutritionEntries
      ? {
          nutrition: {
            calories: num(values.nutrition.calories),
            servings: num(values.nutrition.servings),
            protein: num(values.nutrition.protein),
            fat: num(values.nutrition.fat),
            carbs: num(values.nutrition.carbs),
          },
        }
      : {}),
    allergens: values.allergens,
    dietaryRestrictions: values.dietaryRestrictions,
    intolerances: values.intolerances,
    features: values.features,
    diets: values.diets,
    ingredients,
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  allergens: 'Аллергены',
  dietaryRestrictions: 'Диетические ограничения',
  intolerances: 'Непереносимости',
  features: 'Особенности',
  diets: 'Диеты',
};

function TagCheckboxes({
  categoryKey,
  keys,
  selected,
  onToggle,
}: {
  categoryKey: string;
  keys: string[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {CATEGORY_LABELS[categoryKey]}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {keys.map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={selected.includes(key)} onChange={() => onToggle(key)} />
            {key}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const LANGUAGE_LABELS: Record<string, string> = { en: 'English', ru: 'Russian' };

export function FoodForm({
  options,
  values,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
}: {
  options: FoodFormOptions;
  values: FoodFormValues;
  onChange: (values: FoodFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const languages = options.languages.length ? options.languages : [DEFAULT_LANGUAGE];
  const [activeLanguage, setActiveLanguage] = useState(DEFAULT_LANGUAGE);

  const set = <K extends keyof FoodFormValues>(key: K, value: FoodFormValues[K]) =>
    onChange({ ...values, [key]: value });

  const setTranslation = (language: string, field: 'name' | 'description' | 'content', value: string) =>
    onChange({
      ...values,
      translations: {
        ...values.translations,
        [language]: {
          ...(values.translations[language] ?? { name: '', description: '', content: '' }),
          [field]: value,
        },
      },
    });

  const toggleTag = (category: keyof FoodFormValues, key: string) => {
    const current = values[category] as string[];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    onChange({ ...values, [category]: next });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { imageUrl } = await uploadImage(file);
      set('images', [...values.images, imageUrl]);
    } catch {
      setUploadError('Image upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {languages.map((lang) => {
          const hasName = (values.translations[lang]?.name ?? '').trim() !== '';
          return (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveLanguage(lang)}
              className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${
                activeLanguage === lang
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              {LANGUAGE_LABELS[lang] ?? lang}
              {lang === DEFAULT_LANGUAGE ? ' *' : hasName ? '' : ' (empty)'}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-300">
            Name ({LANGUAGE_LABELS[activeLanguage] ?? activeLanguage})
            {activeLanguage === DEFAULT_LANGUAGE && <span className="text-red-600"> *</span>}
          </span>
          <input
            value={values.translations[activeLanguage]?.name ?? ''}
            onChange={(e) => setTranslation(activeLanguage, 'name', e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-300">
            Description ({LANGUAGE_LABELS[activeLanguage] ?? activeLanguage})
          </span>
          <textarea
            value={values.translations[activeLanguage]?.description ?? ''}
            onChange={(e) => setTranslation(activeLanguage, 'description', e.target.value)}
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-neutral-700 dark:text-neutral-300">Cuisine</span>
          <select
            value={values.cuisineCode}
            onChange={(e) => set('cuisineCode', e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
          >
            <option value="">—</option>
            {options.cuisines.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">Images</span>
        <div className="mb-2 flex flex-wrap gap-2">
          {values.images.map((url, i) => (
            <div key={url} className="relative">
              <img src={url} alt="" className="h-20 w-20 rounded-md object-cover" />
              <button
                type="button"
                onClick={() => set('images', values.images.filter((_, idx) => idx !== i))}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <input type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} />
        {uploading && <p className="text-sm text-neutral-500">Uploading…</p>}
        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(['calories', 'servings', 'protein', 'fat', 'carbs'] as const).map((field) => (
          <label key={field} className="block text-sm">
            <span className="mb-1 block capitalize text-neutral-700 dark:text-neutral-300">{field}</span>
            <input
              type="number"
              value={values.nutrition[field]}
              onChange={(e) => set('nutrition', { ...values.nutrition, [field]: e.target.value })}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <TagCheckboxes
          categoryKey="allergens"
          keys={options.allergens}
          selected={values.allergens}
          onToggle={(k) => toggleTag('allergens', k)}
        />
        <TagCheckboxes
          categoryKey="dietaryRestrictions"
          keys={options.dietaryRestrictions}
          selected={values.dietaryRestrictions}
          onToggle={(k) => toggleTag('dietaryRestrictions', k)}
        />
        <TagCheckboxes
          categoryKey="intolerances"
          keys={options.intolerances}
          selected={values.intolerances}
          onToggle={(k) => toggleTag('intolerances', k)}
        />
        <TagCheckboxes
          categoryKey="features"
          keys={options.features}
          selected={values.features}
          onToggle={(k) => toggleTag('features', k)}
        />
        <TagCheckboxes
          categoryKey="diets"
          keys={options.foodDiets}
          selected={values.diets}
          onToggle={(k) => toggleTag('diets', k)}
        />
      </div>

      <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Content ({LANGUAGE_LABELS[activeLanguage] ?? activeLanguage})
        </span>
        <ArticleEditor
          value={values.translations[activeLanguage]?.content ?? ''}
          onChange={(html) => setTranslation(activeLanguage, 'content', html)}
          placeholder="Write the full recipe article — steps, tips, story…"
        />

        <div className="mt-4">
          <IngredientsEditor
            lines={values.ingredients}
            onChange={(ingredients) => set('ingredients', ingredients)}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !isFoodFormValid(values)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
