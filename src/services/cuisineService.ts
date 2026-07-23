import { prisma } from '../config/prisma';

/**
 * The server-owned cuisine catalog, as the enum codes the client exchanges (e.g.
 * "ITALIAN"). The client maps each code to a localized display name. Ordered by the
 * catalog's `sortOrder` (admin-controllable), ties broken by code for a stable
 * result — same contract as the diet catalog. Doubles as the source of the codes a
 * client may send for a WRONG_CUISINE dislike reason.
 */
export const listCuisines = async (): Promise<string[]> => {
  const cuisines = await prisma.cuisine.findMany({
    select: { code: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  return cuisines.map((c) => c.code);
};
