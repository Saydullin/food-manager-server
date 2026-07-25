import { useState } from 'react';

export const PAGE_SIZE_PRESETS = [20, 40, 60, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

export interface Pagination {
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

/** Shared page/pageSize state for admin list pages. Changing pageSize (or calling
 * `reset`, e.g. when a filter changes) snaps back to page 1 so results stay in view. */
export function usePagination(initialPageSize = DEFAULT_PAGE_SIZE): Pagination {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const setPageSize = (next: number) => {
    setPageSizeState(next);
    setPage(1);
  };

  return { page, pageSize, setPage, setPageSize };
}
