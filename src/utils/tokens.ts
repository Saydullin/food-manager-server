import { createHash, randomBytes, randomInt } from 'crypto';

/** A random URL-safe opaque token (refresh tokens, recovery tokens, verification tokens, nonces). */
export const generateRandomToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');

/** One-way hash used to store opaque tokens at rest (refresh/recovery/verification). */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** A random 4-digit numeric code, zero-padded (e.g. "0482"), for email verification. */
export const generateVerificationCode = (): string =>
  randomInt(0, 10_000).toString().padStart(4, '0');
