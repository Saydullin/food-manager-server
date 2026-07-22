import rateLimit from 'express-rate-limit';

const jsonRateLimitHandler = (message: string) => (_req: unknown, res: import('express').Response) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
};

/** Applied to /challenge and /verify: throttles login attempts per IP. */
export const loginRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many login attempts. Please try again shortly.'),
});

/** Applied to /recovery/request: recovery emails are more expensive/sensitive to spam. */
export const recoveryRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many recovery requests. Please try again later.'),
});

/**
 * Applied to /email/verify-code: on top of the per-record codeAttempts counter, this
 * throttles guessing across records (e.g. requesting a fresh code to reset attempts).
 */
export const emailCodeRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many attempts. Please try again shortly.'),
});
