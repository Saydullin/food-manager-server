import { Prisma, Theme } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';

// The public shape of a user's client-side settings.
export interface UserSettings {
  language: string;
  theme: Theme;
  pushNotificationsEnabled: boolean;
}

// The defaults a brand-new (or row-less) user's settings resolve to. Mirrors the
// column defaults in schema.prisma so a missing row reads the same as a fresh one.
export const DEFAULT_SETTINGS: UserSettings = {
  language: 'en',
  theme: Theme.SYSTEM,
  pushNotificationsEnabled: true,
};

// The settings columns exposed to clients (no userId/timestamps).
const settingsSelect = {
  language: true,
  theme: true,
  pushNotificationsEnabled: true,
} as const;

// What Prisma selects for a profile — includes the free-form food preference and
// exception lists (as related rows). The public shape flattens those to string[].
const profileSelect = {
  id: true,
  username: true,
  email: true,
  emailVerified: true,
  imageUrl: true,
  name: true,
  age: true,
  status: true,
  description: true,
  isBanned: true,
  onboardingCompletedAt: true,
  createdAt: true,
  updatedAt: true,
  foodPreferences: { select: { value: true }, orderBy: { value: 'asc' } },
  foodExceptions: { select: { value: true }, orderBy: { value: 'asc' } },
  // Selected diets, flattened to their catalog codes and ordered like the catalog.
  diets: { select: { diet: { select: { code: true } } }, orderBy: { diet: { sortOrder: 'asc' } } },
  // 1:1 settings row; may be null for accounts that predate the settings table.
  settings: { select: settingsSelect },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

// The public shape of a user profile — never leaks internal-only columns, and
// exposes the food lists as plain arrays of strings rather than related rows.
export interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  imageUrl: string | null;
  name: string | null;
  age: number | null;
  status: string | null;
  description: string | null;
  isBanned: boolean;
  /**
   * Whether this account has been through the onboarding questions. Exposed as a plain
   * boolean (the column is a nullable timestamp) — the client only ever needs to know
   * whether to ask, and a derived boolean keeps that the only thing it can depend on.
   */
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  foodPreferences: string[];
  foodExceptions: string[];
  diets: string[];
  settings: UserSettings;
}

const shapeProfile = (row: UserRow): UserProfile => ({
  id: row.id,
  username: row.username,
  email: row.email,
  emailVerified: row.emailVerified,
  imageUrl: row.imageUrl,
  name: row.name,
  age: row.age,
  status: row.status,
  description: row.description,
  isBanned: row.isBanned,
  onboardingCompleted: row.onboardingCompletedAt !== null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  foodPreferences: row.foodPreferences.map((p) => p.value),
  foodExceptions: row.foodExceptions.map((e) => e.value),
  diets: row.diets.map((d) => d.diet.code),
  // Fall back to defaults if no row exists (pre-settings accounts).
  settings: row.settings ?? { ...DEFAULT_SETTINGS },
});

export const getProfile = async (userId: string): Promise<UserProfile> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return shapeProfile(user);
};

// A partial update of the editable profile fields. Only the keys present are
// changed (the validation layer guarantees at least one). `null` explicitly clears
// an optional field; `username` is required-when-present (never nulled) since it's
// the account's unique login handle.
export interface ProfilePatch {
  username?: string;
  name?: string | null;
  age?: number | null;
  status?: string | null;
  description?: string | null;
}

/**
 * Applies a partial update to the user's editable profile fields and returns the
 * full updated profile. `username` is unique, so a collision surfaces as a clean
 * 409 (USERNAME_TAKEN) — caught from Prisma's P2002 so the check stays atomic (no
 * TOCTOU race against a concurrent registration/rename).
 */
export const updateProfile = async (
  userId: string,
  patch: ProfilePatch,
): Promise<UserProfile> => {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: patch,
      select: profileSelect,
    });
    return shapeProfile(user);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Only `username` is unique among the patchable fields, so P2002 here is
      // always a username collision.
      if (err.code === 'P2002') {
        throw AppError.conflict('Username is already taken', 'USERNAME_TAKEN');
      }
      // The userId comes from a valid access token, so a missing record means the
      // account was deleted out from under a still-valid token — treat as not found.
      if (err.code === 'P2025') {
        throw AppError.notFound('User not found', 'USER_NOT_FOUND');
      }
    }
    throw err;
  }
};

/** Sets (or replaces) the profile image URL. Idempotent — covers both "set" and "change". */
export const setProfileImage = async (userId: string, imageUrl: string): Promise<UserProfile> =>
  updateImageOrThrow(userId, imageUrl);

/** Removes the profile image by clearing the URL back to null. */
export const removeProfileImage = async (userId: string): Promise<UserProfile> =>
  updateImageOrThrow(userId, null);

const updateImageOrThrow = async (
  userId: string,
  imageUrl: string | null,
): Promise<UserProfile> => {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { imageUrl },
      select: profileSelect,
    });
    return shapeProfile(user);
  } catch (err) {
    // The userId comes from a valid access token, so a missing record means the
    // account was deleted out from under a still-valid token — treat as not found.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    throw err;
  }
};

/**
 * Replaces the user's entire food-preference list with `values` (already
 * normalized + de-duplicated by the validation layer). Idempotent: sending the
 * same list twice is a no-op, and sending [] clears the list. Returns the full
 * updated profile so the client always gets a consistent `{ user }` shape.
 */
export const setFoodPreferences = async (
  userId: string,
  values: string[],
): Promise<UserProfile> => {
  await ensureUserExists(userId);
  await prisma.$transaction([
    prisma.userFoodPreference.deleteMany({ where: { userId } }),
    prisma.userFoodPreference.createMany({ data: values.map((value) => ({ userId, value })) }),
  ]);
  return getProfile(userId);
};

/**
 * Replaces the user's entire food-exception list (things they dislike / want
 * avoided). Same replace-in-full semantics as {@link setFoodPreferences}.
 */
export const setFoodExceptions = async (
  userId: string,
  values: string[],
): Promise<UserProfile> => {
  await ensureUserExists(userId);
  await prisma.$transaction([
    prisma.userFoodException.deleteMany({ where: { userId } }),
    prisma.userFoodException.createMany({ data: values.map((value) => ({ userId, value })) }),
  ]);
  return getProfile(userId);
};

/**
 * Stamps the account as having been through the onboarding questions.
 *
 * A one-way latch, and idempotent: re-marking keeps the original timestamp rather than
 * refreshing it, so "when was this user onboarded" survives the client re-sending (which
 * it will — the mobile app retries this on refresh if its local copy says done and the
 * server disagrees, to heal a completion that was recorded while offline).
 *
 * Deliberately not part of `PATCH /users/me/settings`: settings are preferences the user
 * flips back and forth, this is a fact about the account that only ever goes one way.
 */
export const markOnboardingComplete = async (userId: string): Promise<UserProfile> => {
  await ensureUserExists(userId);
  await prisma.user.updateMany({
    where: { id: userId, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: new Date() },
  });
  return getProfile(userId);
};

/**
 * Returns the user's client-side settings. If no row exists yet (an account that
 * predates the settings table), confirms the user is real, then returns the
 * defaults — so the client always gets a consistent, populated settings object.
 */
export const getSettings = async (userId: string): Promise<UserSettings> => {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: settingsSelect,
  });
  if (row) return row;
  await ensureUserExists(userId);
  return { ...DEFAULT_SETTINGS };
};

// A partial settings update: only the provided fields change (validated + defaulted
// to "at least one field present" by the validation layer).
export interface SettingsPatch {
  language?: string;
  theme?: Theme;
  pushNotificationsEnabled?: boolean;
}

/**
 * Applies a partial update to the user's settings and returns the full updated set.
 * Upsert (not update) so it also works for accounts that predate the settings table:
 * an existing row is merged with `patch`; a missing one is created from the column
 * defaults overlaid with `patch`.
 */
export const updateSettings = async (
  userId: string,
  patch: SettingsPatch,
): Promise<UserSettings> => {
  await ensureUserExists(userId);
  return prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: patch,
    select: settingsSelect,
  });
};

// The userId comes from a valid access token; a missing record means the account
// was deleted out from under a still-valid token — surface a clean 404 before we
// try to write child rows (whose FK would otherwise fail with a raw DB error).
export const ensureUserExists = async (userId: string): Promise<void> => {
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
};
