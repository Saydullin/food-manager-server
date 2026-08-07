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

/**
 * The recommendation feed's cursor. Same keyset idea as {@link FeedCursor}, but that
 * feed is ordered by fit score first (see `services/recommendation/ranking`), so the
 * score has to travel in the cursor too — "resume strictly after this (score,
 * createdAt, id)" is only answerable if the client hands back the score it left off
 * at. Ordering by score is also why this can't reuse the two-part cursor: an offset
 * would skip rows as swiped dishes leave the candidate set.
 *
 * `score` round-trips exactly: JS stringifies a double to the shortest decimal that
 * parses back to the same value, so the cursor's own row compares exactly equal and
 * the "strictly after" boundary lands where it should.
 */
export interface RankCursor {
  score: number;
  createdAt: Date;
  id: string;
}

/** Encodes a `(score, createdAt, id)` rank key into an opaque base64url cursor. */
export const encodeRankCursor = ({ score, createdAt, id }: RankCursor): string =>
  Buffer.from(`${score}|${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');

/**
 * Decodes a cursor produced by {@link encodeRankCursor}.
 *
 * Returns `null` — meaning "start from the top of the ranking" — for a legacy
 * two-part `(createdAt, id)` cursor issued before ranking landed. Clients persist
 * the last cursor they were handed (the Android app keeps it in Room), so one
 * deploy's worth of stored cursors would otherwise 400 and wedge those feeds until
 * app data was cleared. Restarting the deck is harmless by comparison: swiped
 * dishes are excluded from the feed regardless, and the client upserts by dish id.
 *
 * Anything else malformed still throws, same as {@link decodeCursor} — a client
 * should only ever echo back a value we handed it.
 */
export const decodeRankCursor = (raw: string): RankCursor | null => {
  const parts = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (parts.length === 2) return null;
  if (parts.length !== 3) throw AppError.badRequest('Malformed cursor', 'INVALID_CURSOR');

  const [rawScore, rawCreatedAt, id] = parts;
  const score = Number(rawScore);
  const createdAt = new Date(rawCreatedAt);
  if (rawScore.trim() === '' || !Number.isFinite(score) || Number.isNaN(createdAt.getTime()) || !id) {
    throw AppError.badRequest('Malformed cursor', 'INVALID_CURSOR');
  }
  return { score, createdAt, id };
};
