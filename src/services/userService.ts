import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';

// What Prisma selects for a profile — includes the free-form food preference and
// exception lists (as related rows). The public shape flattens those to string[].
const profileSelect = {
  id: true,
  username: true,
  email: true,
  emailVerified: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
  foodPreferences: { select: { value: true }, orderBy: { value: 'asc' } },
  foodExceptions: { select: { value: true }, orderBy: { value: 'asc' } },
  // Selected diets, flattened to their catalog codes and ordered like the catalog.
  diets: { select: { diet: { select: { code: true } } }, orderBy: { diet: { sortOrder: 'asc' } } },
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
  createdAt: Date;
  updatedAt: Date;
  foodPreferences: string[];
  foodExceptions: string[];
  diets: string[];
}

const shapeProfile = (row: UserRow): UserProfile => ({
  id: row.id,
  username: row.username,
  email: row.email,
  emailVerified: row.emailVerified,
  imageUrl: row.imageUrl,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  foodPreferences: row.foodPreferences.map((p) => p.value),
  foodExceptions: row.foodExceptions.map((e) => e.value),
  diets: row.diets.map((d) => d.diet.code),
});

export const getProfile = async (userId: string): Promise<UserProfile> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return shapeProfile(user);
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

// The userId comes from a valid access token; a missing record means the account
// was deleted out from under a still-valid token — surface a clean 404 before we
// try to write child rows (whose FK would otherwise fail with a raw DB error).
export const ensureUserExists = async (userId: string): Promise<void> => {
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
};
