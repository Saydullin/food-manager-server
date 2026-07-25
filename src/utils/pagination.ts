// Offset pagination for admin-panel list endpoints, where arbitrary page jumps
// and a total count are needed for page-number UI. Unlike the keyset cursor
// pagination in cursor.ts (used by the mobile feed), these lists aren't subject
// to a shrinking/growing exclusion set between requests, so a plain skip/take
// is safe and simpler for admins to navigate.
export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const toPagedResult = <T>(items: T[], page: number, pageSize: number, total: number): PagedResult<T> => ({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});
