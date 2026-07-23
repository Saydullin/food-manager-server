import { z } from 'zod';

const username = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric or underscore only');

const publicKey = z.string().min(1, 'publicKey is required');
const deviceLabel = z.string().max(100).optional();
const email = z.string().email();
const code = z.string().regex(/^\d{6}$/, 'code must be a 6-digit number');

export const registerSchema = z.object({
  username,
  publicKey,
  deviceLabel,
  email: email.optional(),
});

export const challengeSchema = z.object({
  username,
});

export const usernameAvailabilitySchema = z.object({
  username,
});

export const verifySchema = z.object({
  challengeId: z.string().uuid(),
  signature: z.string().min(1),
  deviceId: z.string().uuid(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const emailAddSchema = z.object({
  email,
});

export const emailVerifyQuerySchema = z.object({
  token: z.string().min(1),
});

export const emailVerifyCodeSchema = z.object({
  code,
});

export const recoveryRequestSchema = z
  .object({
    username: username.optional(),
    email: email.optional(),
  })
  .refine((data) => data.username ?? data.email, {
    message: 'Provide either username or email',
  });

export const recoveryConfirmSchema = z.object({
  recoveryToken: z.string().min(1),
  newPublicKey: publicKey,
  deviceLabel,
});

// Login / restore access by username + email, confirmed with an emailed 6-digit code.
// Both username and email are required (and must match a verified account) — unlike
// /recovery/request which accepts either — since this backs a login screen where the
// user types both, and the code is only ever sent to the account's on-file address.
export const recoveryRequestCodeSchema = z.object({
  username,
  email,
});

export const recoveryConfirmCodeSchema = z.object({
  username,
  email,
  code,
  newPublicKey: publicKey,
  deviceLabel,
});

export const deviceAddSchema = z.object({
  publicKey,
  deviceLabel,
});
