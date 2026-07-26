import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { toPagedResult, type PagedResult } from '../utils/pagination';
import { sendAccountBlockedEmail, sendAccountUnblockedEmail } from './emailService';

// The safe fields exposed to the admin panel — never device public keys or
// token hashes, same boundary userService.profileSelect draws for the mobile API.
const userListSelect = {
  id: true,
  username: true,
  email: true,
  emailVerified: true,
  imageUrl: true,
  name: true,
  status: true,
  isBanned: true,
  bannedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export interface UserListItem {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  imageUrl: string | null;
  name: string | null;
  status: string | null;
  isBanned: boolean;
  bannedAt: Date | null;
  createdAt: Date;
}

export interface ListUsersParams {
  search?: string;
  page: number;
  pageSize: number;
}

export const listUsers = async ({ search, page, pageSize }: ListUsersParams): Promise<PagedResult<UserListItem>> => {
  const where: Prisma.UserWhereInput = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userListSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return toPagedResult(rows, page, pageSize, total);
};

export interface UserDetail extends UserListItem {
  age: number | null;
  description: string | null;
  interactionCount: number;
  complaintsAgainstCount: number;
  complaintsFiledCount: number;
  foodPreferences: string[];
  foodExceptions: string[];
  diets: string[];
  settings: { language: string; theme: string; pushNotificationsEnabled: boolean } | null;
}

export const getUserDetail = async (userId: string): Promise<UserDetail> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...userListSelect,
      age: true,
      status: true,
      description: true,
      foodPreferences: { select: { value: true } },
      foodExceptions: { select: { value: true } },
      diets: { select: { diet: { select: { code: true } } } },
      settings: { select: { language: true, theme: true, pushNotificationsEnabled: true } },
    },
  });
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

  const { foodPreferences, foodExceptions, diets, settings, ...userFields } = user;

  const [interactionCount, complaintsAgainstCount, complaintsFiledCount] = await Promise.all([
    prisma.foodInteraction.count({ where: { userId } }),
    prisma.complaint.count({ where: { targetUserId: userId } }),
    prisma.complaint.count({ where: { reporterId: userId } }),
  ]);

  return {
    ...userFields,
    interactionCount,
    complaintsAgainstCount,
    complaintsFiledCount,
    foodPreferences: foodPreferences.map((p) => p.value),
    foodExceptions: foodExceptions.map((e) => e.value),
    diets: diets.map((d) => d.diet.code),
    settings,
  };
};

export const setStatus = async (userId: string, status: string | null): Promise<UserListItem> => {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: { status },
      select: userListSelect,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    throw err;
  }
};

export const setBanned = async (userId: string, banned: boolean): Promise<UserListItem> => {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isBanned: banned, bannedAt: banned ? new Date() : null },
      select: userListSelect,
    });

    if (user.email) {
      void (banned ? sendAccountBlockedEmail(user.email) : sendAccountUnblockedEmail(user.email));
    }

    return user;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    throw err;
  }
};
