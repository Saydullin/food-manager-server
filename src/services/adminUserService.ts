import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { decodeCursor, encodeCursor } from '../utils/cursor';
import { type Page } from './foodService';

// The safe fields exposed to the admin panel — never device public keys or
// token hashes, same boundary userService.profileSelect draws for the mobile API.
const userListSelect = {
  id: true,
  username: true,
  email: true,
  emailVerified: true,
  imageUrl: true,
  name: true,
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
  isBanned: boolean;
  bannedAt: Date | null;
  createdAt: Date;
}

export interface ListUsersParams {
  search?: string;
  limit: number;
  cursor?: string;
}

export const listUsers = async ({ search, limit, cursor }: ListUsersParams): Promise<Page<UserListItem>> => {
  const decoded = cursor ? decodeCursor(cursor) : null;

  const rows = await prisma.user.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { createdAt: decoded.createdAt, id: { lt: decoded.id } },
            ],
          }
        : {}),
    },
    select: userListSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return {
    items: kept,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    hasMore,
  };
};

export interface UserDetail extends UserListItem {
  age: number | null;
  status: string | null;
  description: string | null;
  interactionCount: number;
  complaintsAgainstCount: number;
  complaintsFiledCount: number;
}

export const getUserDetail = async (userId: string): Promise<UserDetail> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...userListSelect, age: true, status: true, description: true },
  });
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

  const [interactionCount, complaintsAgainstCount, complaintsFiledCount] = await Promise.all([
    prisma.foodInteraction.count({ where: { userId } }),
    prisma.complaint.count({ where: { targetUserId: userId } }),
    prisma.complaint.count({ where: { reporterId: userId } }),
  ]);

  return { ...user, interactionCount, complaintsAgainstCount, complaintsFiledCount };
};

export const setBanned = async (userId: string, banned: boolean): Promise<UserListItem> => {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: { isBanned: banned, bannedAt: banned ? new Date() : null },
      select: userListSelect,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }
    throw err;
  }
};
