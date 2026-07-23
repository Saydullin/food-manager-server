import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { ensureUserExists, getProfile, type UserProfile } from './userService';

/**
 * The server-owned diet catalog, as the enum codes the client exchanges. The
 * client maps each code to a localized display name. Ordered by the catalog's
 * `sortOrder` (admin-controllable), ties broken by code for a stable result.
 */
export const listDiets = async (): Promise<string[]> => {
  const diets = await prisma.diet.findMany({
    select: { code: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  return diets.map((d) => d.code);
};

/**
 * Replaces the user's entire selected-diet set with `codes` (already normalized +
 * de-duplicated by validation). Idempotent: re-sending the same set is a no-op,
 * and [] clears the selection. Every code must exist in the catalog — unknown
 * codes are rejected as a 400 rather than silently dropped. Returns the full
 * updated profile so the client gets a consistent `{ user }` shape.
 */
export const setUserDiets = async (userId: string, codes: string[]): Promise<UserProfile> => {
  await ensureUserExists(userId);

  // Resolve codes -> catalog rows, and reject any that don't exist.
  const found = codes.length
    ? await prisma.diet.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } })
    : [];

  if (found.length !== codes.length) {
    const known = new Set(found.map((d) => d.code));
    const unknown = codes.filter((c) => !known.has(c));
    throw AppError.badRequest(`Unknown diet code(s): ${unknown.join(', ')}`, 'UNKNOWN_DIET');
  }

  await prisma.$transaction([
    prisma.userDiet.deleteMany({ where: { userId } }),
    prisma.userDiet.createMany({ data: found.map((d) => ({ userId, dietId: d.id })) }),
  ]);

  return getProfile(userId);
};
