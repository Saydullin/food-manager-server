import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Centralized, validated environment configuration.
 *
 * Every process.env access in the app goes through this module so that:
 *  - a missing/invalid var fails fast at boot with a clear message, and
 *  - the rest of the code gets typed, parsed values (numbers as numbers, etc).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  CORS_ORIGIN: z.string().default('*'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Local disk directory (relative to the process cwd) where uploaded files are
  // stored and from which they're served back at `${APP_BASE_URL}/uploads/...`.
  UPLOAD_DIR: z.string().default('uploads'),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(5),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  // Admin panel auth. Deliberately a separate secret from JWT_SECRET so an admin
  // access token can never be replayed against the mobile-app's user-auth routes
  // (or vice versa) even if one secret ever leaked.
  ADMIN_JWT_SECRET: z.string().min(16, 'ADMIN_JWT_SECRET must be at least 16 chars'),
  ADMIN_ACCESS_TOKEN_TTL: z.string().default('12h'),

  // Timing windows, in SECONDS.
  CHALLENGE_TTL: z.coerce.number().int().positive().default(120),
  RECOVERY_TOKEN_TTL: z.coerce.number().int().positive().default(1800),
  EMAIL_VERIFICATION_TTL: z.coerce.number().int().positive().default(86400),
  // Short-lived, since it's a 4-digit code meant to be typed in immediately.
  EMAIL_CODE_TTL: z.coerce.number().int().positive().default(600),
  // Failed-attempt limit before a code is rejected outright (4 digits = only 1e4 possibilities).
  EMAIL_CODE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // Recovery via email code (login / restore access by username + email). Short-lived
  // like the email-verification code, with the same brute-force attempt cap.
  RECOVERY_CODE_TTL: z.coerce.number().int().positive().default(600),
  RECOVERY_CODE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // SMTP — optional. When SMTP_HOST is unset, emails are console-logged instead of sent
  // (handy for local dev without real credentials).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Food Manager <no-reply@example.com>'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable summary of what's wrong.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[env] Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
