import { createHash, randomBytes, randomInt } from 'crypto';

/** A random URL-safe opaque token (refresh tokens, recovery tokens, verification tokens, nonces). */
export const generateRandomToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');

/** One-way hash used to store opaque tokens at rest (refresh/recovery/verification). */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** A random 6-digit numeric code, zero-padded (e.g. "004821"), for email verification. */
export const generateVerificationCode = (): string =>
  randomInt(0, 1_000_000).toString().padStart(6, '0');
