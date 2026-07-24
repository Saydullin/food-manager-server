import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import type { Food, FoodFormOptions, Page } from '../lib/types';
import {
  FoodForm,
  emptyFoodForm,
  foodToFormValues,
  formValuesToPayload,
  type FoodFormValues,
} from '../components/FoodForm';

export function RecipesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [editing, setEditing] = useState<Food | 'new' | null>(null);
  const [formValues, setFormValues] = useState<FoodFormValues>(emptyFoodForm());

  const optionsQuery = useQuery({
    queryKey: ['food-form-options'],
    queryFn: () => api.get<FoodFormOptions>('/admin/meta/food-form-options'),
  });

  const foodsQuery = useQuery({
    queryKey: ['foods', debouncedSearch],
    queryFn: () =>
      api.get<Page<Food>>('/admin/foods', { search: debouncedSearch || undefined, limit: 50 }),
  });

  const invalidateFoods = () => queryClient.invalidateQueries({ queryKey: ['foods'] });

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof formValuesToPayload>) => api.post('/admin/foods', payload),
    onSuccess: () => {
      invalidateFoods();
      setEditing(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof formValuesToPayload> }) =>
      api.patch(`/admin/foods/${id}`, payload),
    onSuccess: () => {
      invalidateFoods();
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/foods/${id}`),
    onSuccess: invalidateFoods,
  });

  const startCreate = () => {
    setFormValues(emptyFoodForm());
    setEditing('new');
  };

  const startEdit = (food: Food) => {
    setFormValues(foodToFormValues(food));
    setEditing(food);
  };

  const handleSubmit = () => {
    const payload = formValuesToPayload(formValues);
    if (editing === 'new') {
      createMutation.mutate(payload);
    } else if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    }
  };

  const handleDelete = (food: Food) => {
    if (confirm(`Delete "${food.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(food.id);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Recipes</h2>
        {editing === null && (
          <button
            onClick={startCreate}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            + New recipe
          </button>
        )}
      </div>

      {editing !== null && optionsQuery.data && (
        <div className="mb-6">
          <FoodForm
            options={optionsQuery.data}
            values={formValues}
            onChange={setFormValues}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
            submitting={createMutation.isPending || updateMutation.isPending}
            submitLabel={editing === 'new' ? 'Create' : 'Save changes'}
          />
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name…"
        className="mb-4 w-full max-w-sm rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
      />

      {foodsQuery.isLoading && <p className="text-neutral-500">Loading…</p>}
      {foodsQuery.data && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-100 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2">Image</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Cuisine</th>
                <th className="px-4 py-2">Calories</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {foodsQuery.data.items.map((food) => (
                <tr key={food.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-4 py-2">
                    {food.images[0] ? (
                      <img src={food.images[0]} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-neutral-200 dark:bg-neutral-800" />
                    )}
                  </td>
                  <td className="px-4 py-2 font-medium">{food.name}</td>
                  <td className="px-4 py-2 text-neutral-500">{food.cuisine ?? '—'}</td>
                  <td className="px-4 py-2 text-neutral-500">{food.nutrition?.calories ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => startEdit(food)} className="mr-3 text-sm text-blue-600 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(food)} className="text-sm text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {foodsQuery.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                    No recipes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
