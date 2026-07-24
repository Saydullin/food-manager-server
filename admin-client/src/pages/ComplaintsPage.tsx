import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Complaint, ComplaintStatus, Page } from '../lib/types';

const TABS: { label: string; value: ComplaintStatus | undefined }[] = [
  { label: 'Open', value: 'OPEN' },
  { label: 'Resolved', value: 'RESOLVED' },
  { label: 'Dismissed', value: 'DISMISSED' },
  { label: 'All', value: undefined },
];

export function ComplaintsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ComplaintStatus | undefined>('OPEN');

  const complaintsQuery = useQuery({
    queryKey: ['complaints', status],
    queryFn: () => api.get<Page<Complaint>>('/admin/complaints', { status, limit: 50 }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'RESOLVED' | 'DISMISSED' }) =>
      api.patch(`/admin/complaints/${id}`, { status: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['complaints'] }),
  });

  return (
    <div>
      <h2 className="mb-6 text-2xl font-semibold">Complaints</h2>

      <div className="mb-4 flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setStatus(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              status === tab.value
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {complaintsQuery.isLoading && <p className="text-neutral-500">Loading…</p>}
      {complaintsQuery.data && (
        <div className="flex flex-col gap-3">
          {complaintsQuery.data.items.map((complaint) => (
            <div
              key={complaint.id}
              className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">
                  {complaint.reporter.username} reported{' '}
                  {complaint.targetType === 'USER'
                    ? `user "${complaint.targetUser?.username ?? 'unknown'}"`
                    : `dish "${complaint.targetFood?.name ?? 'unknown'}"`}
                </span>
                <span className="text-xs text-neutral-500">
                  {new Date(complaint.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mb-3 text-neutral-600 dark:text-neutral-400">{complaint.reason}</p>
              {complaint.status === 'OPEN' ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => resolveMutation.mutate({ id: complaint.id, next: 'RESOLVED' })}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => resolveMutation.mutate({ id: complaint.id, next: 'DISMISSED' })}
                    className="rounded-md bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">
                  {complaint.status === 'RESOLVED' ? 'Resolved' : 'Dismissed'} by{' '}
                  {complaint.resolvedByAdmin?.name ?? 'unknown'} on{' '}
                  {complaint.resolvedAt ? new Date(complaint.resolvedAt).toLocaleString() : '—'}
                </p>
              )}
            </div>
          ))}
          {complaintsQuery.data.items.length === 0 && (
            <p className="text-neutral-500">No complaints in this view.</p>
          )}
        </div>
      )}
    </div>
  );
}
