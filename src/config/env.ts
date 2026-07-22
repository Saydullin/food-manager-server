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

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  // Timing windows, in SECONDS.
  CHALLENGE_TTL: z.coerce.number().int().positive().default(120),
  RECOVERY_TOKEN_TTL: z.coerce.number().int().positive().default(1800),
  EMAIL_VERIFICATION_TTL: z.coerce.number().int().positive().default(86400),
  // Short-lived, since it's a 6-digit code meant to be typed in immediately.
  EMAIL_CODE_TTL: z.coerce.number().int().positive().default(600),
  // Failed-attempt limit before a code is rejected outright (6 digits = only 1e6 possibilities).
  EMAIL_CODE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // SMTP — optional for now (links are console-logged until real email is wired up).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
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
