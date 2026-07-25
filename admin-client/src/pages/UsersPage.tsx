import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import { usePagination } from '../lib/usePagination';
import { PaginationControls } from '../components/PaginationControls';
import type { AdminUserDetail, AdminUserListItem, Page } from '../lib/types';

export function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pagination = usePagination();
  const { page, pageSize, setPage } = pagination;

  useEffect(() => setPage(1), [debouncedSearch, setPage]);

  const usersQuery = useQuery({
    queryKey: ['users', debouncedSearch, page, pageSize],
    queryFn: () =>
      api.get<Page<AdminUserListItem>>('/admin/users', {
        search: debouncedSearch || undefined,
        page,
        pageSize,
      }),
  });

  const detailQuery = useQuery({
    queryKey: ['user', selectedId],
    queryFn: () => api.get<{ user: AdminUserDetail }>(`/admin/users/${selectedId}`),
    enabled: !!selectedId,
  });

  const banMutation = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) =>
      api.post(`/admin/users/${id}/${banned ? 'ban' : 'unban'}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user', selectedId] });
    },
  });

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2">
        <h2 className="mb-6 text-2xl font-semibold">Users</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username or email…"
          className="mb-4 w-full max-w-sm rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
        {usersQuery.isLoading && <p className="text-neutral-500">Loading…</p>}
        {usersQuery.data && (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-100 dark:bg-neutral-900">
                <tr>
                  <th className="px-4 py-2">Username</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.items.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedId(user.id)}
                    className={`cursor-pointer border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                      selectedId === user.id ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                    }`}
                  >
                    <td className="px-4 py-2 font-medium">{user.username}</td>
                    <td className="px-4 py-2 text-neutral-500">{user.email ?? '—'}</td>
                    <td className="px-4 py-2">
                      {user.isBanned ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                          Banned
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          banMutation.mutate({ id: user.id, banned: !user.isBanned });
                        }}
                        className={`text-sm hover:underline ${user.isBanned ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {user.isBanned ? 'Unban' : 'Ban'}
                      </button>
                    </td>
                  </tr>
                ))}
                {usersQuery.data.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {usersQuery.data && (
          <PaginationControls
            pagination={pagination}
            total={usersQuery.data.total}
            totalPages={usersQuery.data.totalPages}
          />
        )}
      </div>

      <div>
        <h2 className="mb-6 text-2xl font-semibold">Details</h2>
        {!selectedId && <p className="text-neutral-500">Select a user to see details.</p>}
        {detailQuery.data && (
          <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <p className="mb-1">
              <span className="font-medium">Username:</span> {detailQuery.data.user.username}
            </p>
            <p className="mb-1">
              <span className="font-medium">Name:</span> {detailQuery.data.user.name ?? '—'}
            </p>
            <p className="mb-1">
              <span className="font-medium">Email:</span> {detailQuery.data.user.email ?? '—'}
              {detailQuery.data.user.email && !detailQuery.data.user.emailVerified && ' (unverified)'}
            </p>
            <p className="mb-1">
              <span className="font-medium">Age:</span> {detailQuery.data.user.age ?? '—'}
            </p>
            <p className="mb-1">
              <span className="font-medium">Status:</span> {detailQuery.data.user.status ?? '—'}
            </p>
            <p className="mb-1">
              <span className="font-medium">Bio:</span> {detailQuery.data.user.description ?? '—'}
            </p>
            <p className="mb-1">
              <span className="font-medium">Joined:</span>{' '}
              {new Date(detailQuery.data.user.createdAt).toLocaleDateString()}
            </p>
            <p className="mb-1">
              <span className="font-medium">Swipes recorded:</span> {detailQuery.data.user.interactionCount}
            </p>
            <p className="mb-1">
              <span className="font-medium">Complaints against:</span>{' '}
              {detailQuery.data.user.complaintsAgainstCount}
            </p>
            <p className="mb-3">
              <span className="font-medium">Complaints filed:</span> {detailQuery.data.user.complaintsFiledCount}
            </p>
            <button
              onClick={() =>
                banMutation.mutate({ id: detailQuery.data.user.id, banned: !detailQuery.data.user.isBanned })
              }
              className={`w-full rounded-md px-3 py-2 text-sm font-medium text-white ${
                detailQuery.data.user.isBanned ? 'bg-green-600' : 'bg-red-600'
              }`}
            >
              {detailQuery.data.user.isBanned ? 'Unban user' : 'Ban user'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
