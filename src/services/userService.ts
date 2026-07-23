import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';

// The public shape of a user profile — never leaks internal-only columns.
const profileSelect = {
  id: true,
  username: true,
  email: true,
  emailVerified: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type UserProfile = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

export const getProfile = async (userId: string): Promise<UserProfile> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return user;
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
    return await prisma.user.update({
      where: { id: userId },
      data: { imageUrl },
      select: profileSelect,
    });
  } catch (err) {
    // The userId comes from a valid access token, so a missing record means the
    // account was deleted out from under a still-valid token — treat as not found.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    throw err;
  }
};
