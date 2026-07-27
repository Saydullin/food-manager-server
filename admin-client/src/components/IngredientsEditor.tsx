import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import type { Ingredient } from '../lib/types';

export interface IngredientLine {
  // Client-only stable key for React lists — not sent to the server.
  key: string;
  // Set when the line references an existing catalog ingredient; omitted for
  // a new ingredient the admin is typing inline (resolved/created server-side).
  ingredientId?: string;
  name: string;
  amount: string;
  unit: string;
}

const UNITS = ['г', 'кг', 'мл', 'л', 'шт', 'ст.л.', 'ч.л.'];

const newKey = (): string => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export function IngredientsEditor({
  lines,
  onChange,
}: {
  lines: IngredientLine[];
  onChange: (lines: IngredientLine[]) => void;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);

  const ingredientsQuery = useQuery({
    queryKey: ['ingredients', debouncedSearch],
    queryFn: () => api.get<{ ingredients: Ingredient[] }>('/admin/ingredients', { search: debouncedSearch || undefined }),
    enabled: debouncedSearch.trim() !== '',
  });

  const alreadyAdded = new Set(lines.map((l) => l.ingredientId).filter(Boolean));
  const suggestions = (ingredientsQuery.data?.ingredients ?? []).filter((i) => !alreadyAdded.has(i.id));
  const exactMatch = suggestions.some((i) => i.name.toLowerCase() === search.trim().toLowerCase());

  const addLine = (line: Pick<IngredientLine, 'ingredientId' | 'name'>) => {
    onChange([...lines, { key: newKey(), amount: '', unit: 'г', ...line }]);
    setSearch('');
  };

  const updateLine = (key: string, patch: Partial<IngredientLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => onChange(lines.filter((l) => l.key !== key));

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">Ingredients</span>

      {lines.length > 0 && (
        <div className="mb-3 space-y-2">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm">{line.name}</span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Amount"
                value={line.amount}
                onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              />
              <select
                value={line.unit}
                onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white"
                title="Remove ingredient"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search or add an ingredient…"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
        {search.trim() !== '' && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
            {ingredientsQuery.isFetching && (
              <div className="px-3 py-2 text-sm text-neutral-500">Searching…</div>
            )}
            {!ingredientsQuery.isFetching &&
              suggestions.map((ing) => (
                <button
                  key={ing.id}
                  type="button"
                  onClick={() => addLine({ ingredientId: ing.id, name: ing.name })}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  {ing.name}
                </button>
              ))}
            {!ingredientsQuery.isFetching && !exactMatch && (
              <button
                type="button"
                onClick={() => addLine({ name: search.trim() })}
                className="block w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                + Add "{search.trim()}" as new ingredient
              </button>
            )}
            {!ingredientsQuery.isFetching && suggestions.length === 0 && exactMatch && (
              <div className="px-3 py-2 text-sm text-neutral-500">Already added</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
