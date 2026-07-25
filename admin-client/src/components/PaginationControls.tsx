import { useState } from 'react';
import { PAGE_SIZE_PRESETS, type Pagination } from '../lib/usePagination';

interface PaginationControlsProps {
  pagination: Pagination;
  total: number;
  totalPages: number;
}

export function PaginationControls({ pagination, total, totalPages }: PaginationControlsProps) {
  const { page, pageSize, setPage, setPageSize } = pagination;
  const isCustomSize = !(PAGE_SIZE_PRESETS as readonly number[]).includes(pageSize);
  const [showCustom, setShowCustom] = useState(isCustomSize);
  const [customValue, setCustomValue] = useState(String(pageSize));

  const handleSizeSelect = (value: string) => {
    if (value === 'custom') {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    setPageSize(Number(value));
  };

  const applyCustomSize = () => {
    const parsed = Math.floor(Number(customValue));
    if (Number.isFinite(parsed) && parsed > 0) {
      setPageSize(parsed);
    }
  };

  if (total === 0) return null;

  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-neutral-500">
        <span>
          {rangeStart}–{rangeEnd} of {total}
        </span>
        <label className="ml-2 flex items-center gap-1">
          Rows per page:
          <select
            value={showCustom ? 'custom' : String(pageSize)}
            onChange={(e) => handleSizeSelect(e.target.value)}
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          >
            {PAGE_SIZE_PRESETS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {showCustom && (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyCustomSize()}
              className="w-20 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
            />
            <button
              onClick={applyCustomSize}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium dark:border-neutral-700"
            >
              Apply
            </button>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700"
        >
          Previous
        </button>
        <span className="text-neutral-500">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700"
        >
          Next
        </button>
      </div>
    </div>
  );
}
