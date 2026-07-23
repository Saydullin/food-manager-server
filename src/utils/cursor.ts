import { AppError } from './errors';

/**
 * Keyset (cursor) pagination helpers for feeds ordered by `(createdAt DESC, id DESC)`.
 *
 * Why keyset and not offset/`skip`: the food feed subtracts the dishes a user has
 * already swiped, and that set grows as they swipe — so a fixed offset would skip
 * or repeat rows between pages. A cursor pointing at the last row seen ("give me
 * what sorts strictly after this (createdAt, id)") is stable under those inserts.
 *
 * The cursor is an opaque, URL-safe base64 blob so clients treat it as a token and
 * never build their own — the encoding can change without a client change.
 */
export interface FeedCursor {
  createdAt: Date;
  id: string;
}

/** Encodes a `(createdAt, id)` pair into an opaque base64url cursor string. */
export const encodeCursor = ({ createdAt, id }: FeedCursor): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');

/**
 * Decodes a cursor produced by {@link encodeCursor}. A malformed/tampered cursor is
 * a client error (they should only ever echo back a value we handed them), so this
 * throws a 400 rather than silently ignoring it — a silently-dropped cursor would
 * restart pagination from the top and loop forever.
 */
export const decodeCursor = (raw: string): FeedCursor => {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.indexOf('|');
  if (sep === -1) throw AppError.badRequest('Malformed cursor', 'INVALID_CURSOR');

  const createdAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw AppError.badRequest('Malformed cursor', 'INVALID_CURSOR');
  }
  return { createdAt, id };
};
