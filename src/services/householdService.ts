import { Prisma, type KitchenAppliance, type MedicalRestriction, type Sex } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { pickByLanguage } from '../utils/i18n';
import { DEFAULT_LANGUAGE } from './foodService';
import { ensureUserExists } from './userService';
import type { PutEaterInput } from '../validation/householdSchemas';

/**
 * The "cook dinner" household: the people a user cooks for, the equipment in their
 * kitchen, and what they have at home. All three are owned by the account and only
 * ever read or replaced by it.
 */

/** A generous ceiling — a table, not a canteen. Bounds per-request dinner filter size too. */
export const MAX_EATERS = 20;

// ---------------------------------------------------------------------------
// Eaters
// ---------------------------------------------------------------------------

export interface EaterView {
  id: string;
  name: string;
  sex: Sex | null;
  age: number | null;
  likes: string[];
  avoid: string[];
  allergens: string[];
  diets: string[];
  medicalRestrictions: MedicalRestriction[];
  createdAt: Date;
  updatedAt: Date;
}

const eaterSelect = {
  id: true,
  name: true,
  sex: true,
  age: true,
  likes: true,
  avoid: true,
  allergens: true,
  diets: true,
  medicalRestrictions: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.HouseholdEaterSelect;

/** In the order they were added — the order the client shows them in. */
export const listEaters = async (userId: string): Promise<EaterView[]> => {
  await ensureUserExists(userId);
  return prisma.householdEater.findMany({
    where: { userId },
    select: eaterSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
};

const assertDietsExist = async (codes: string[]): Promise<void> => {
  if (!codes.length) return;
  const found = await prisma.diet.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  if (found.length === codes.length) return;
  const known = new Set(found.map((d) => d.code));
  const unknown = codes.filter((c) => !known.has(c));
  throw AppError.badRequest(`Unknown diet code(s): ${unknown.join(', ')}`, 'UNKNOWN_DIET');
};

const eaterNotFound = () => AppError.notFound('Eater not found', 'EATER_NOT_FOUND');

/**
 * Creates or fully replaces an eater under a client-chosen id. Idempotent, so the
 * app can create someone offline and safely replay the request.
 *
 * Ownership is enforced by updating only `{ id, userId }` and, failing that,
 * creating: if the id already belongs to another account the create collides on
 * the primary key, which is reported as 404 — the same answer as a non-existent id,
 * so the endpoint never confirms that someone else's id exists.
 */
export const putEater = async (
  userId: string,
  eaterId: string,
  input: PutEaterInput,
): Promise<EaterView> => {
  await ensureUserExists(userId);
  await assertDietsExist(input.diets);

  const updated = await prisma.householdEater.updateMany({
    where: { id: eaterId, userId },
    data: input,
  });
  if (updated.count === 0) {
    const count = await prisma.householdEater.count({ where: { userId } });
    if (count >= MAX_EATERS) {
      throw AppError.badRequest(
        `A household can have at most ${MAX_EATERS} eaters`,
        'TOO_MANY_EATERS',
      );
    }
    try {
      await prisma.householdEater.create({ data: { ...input, id: eaterId, userId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw eaterNotFound();
      throw err;
    }
  }

  return prisma.householdEater.findUniqueOrThrow({ where: { id: eaterId }, select: eaterSelect });
};

/** Idempotent: removing an eater that's already gone (or never existed) is not an error. */
export const deleteEater = async (
  userId: string,
  eaterId: string,
): Promise<{ removed: boolean }> => {
  const { count } = await prisma.householdEater.deleteMany({ where: { id: eaterId, userId } });
  return { removed: count > 0 };
};

/**
 * The given eaters, all of which must belong to the user. Any unknown id is a 404 —
 * silently cooking for fewer people than were asked about would be the worse failure.
 */
export const getOwnedEaters = async (userId: string, eaterIds: string[]) => {
  if (!eaterIds.length) return [];
  const rows = await prisma.householdEater.findMany({ where: { userId, id: { in: eaterIds } } });
  if (rows.length !== eaterIds.length) throw eaterNotFound();
  return rows;
};

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

export interface KitchenView {
  /** `null` = the user was never asked; [] = asked, nothing selected. */
  appliances: KitchenAppliance[] | null;
}

export const getKitchen = async (userId: string): Promise<KitchenView> => {
  await ensureUserExists(userId);
  const row = await prisma.userKitchen.findUnique({
    where: { userId },
    select: { appliances: true },
  });
  return { appliances: row?.appliances ?? null };
};

export const setKitchen = async (
  userId: string,
  appliances: KitchenAppliance[],
): Promise<KitchenView> => {
  await ensureUserExists(userId);
  const row = await prisma.userKitchen.upsert({
    where: { userId },
    create: { userId, appliances },
    update: { appliances },
    select: { appliances: true },
  });
  return { appliances: row.appliances };
};

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

export interface PantryItemView {
  ingredientId: string;
  /** Resolved to the requested language, with the catalog's usual fallback. */
  name: string;
}

export const getPantry = async (
  userId: string,
  lang: string = DEFAULT_LANGUAGE,
): Promise<PantryItemView[]> => {
  await ensureUserExists(userId);
  const rows = await prisma.userPantryItem.findMany({
    where: { userId },
    select: {
      ingredientId: true,
      ingredient: { select: { translations: { select: { language: true, name: true } } } },
    },
  });
  return rows
    .map((r) => ({
      ingredientId: r.ingredientId,
      name: pickByLanguage(r.ingredient.translations, lang, DEFAULT_LANGUAGE)?.name ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** The pantry's ingredient ids, for the dinner filter. */
export const getPantryIds = async (userId: string): Promise<Set<string>> => {
  const rows = await prisma.userPantryItem.findMany({
    where: { userId },
    select: { ingredientId: true },
  });
  return new Set(rows.map((r) => r.ingredientId));
};

/**
 * Replaces the pantry in full (same convention as the food preference lists). Every
 * id must be a catalog ingredient — an unknown one is a 400, not silently dropped.
 */
export const setPantry = async (
  userId: string,
  ingredientIds: string[],
  lang: string = DEFAULT_LANGUAGE,
): Promise<PantryItemView[]> => {
  await ensureUserExists(userId);

  if (ingredientIds.length) {
    const found = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds } },
      select: { id: true },
    });
    if (found.length !== ingredientIds.length) {
      const known = new Set(found.map((i) => i.id));
      const unknown = ingredientIds.filter((id) => !known.has(id));
      throw AppError.badRequest(
        `Unknown ingredient id(s): ${unknown.join(', ')}`,
        'UNKNOWN_INGREDIENT',
      );
    }
  }

  await prisma.$transaction([
    prisma.userPantryItem.deleteMany({ where: { userId } }),
    prisma.userPantryItem.createMany({
      data: ingredientIds.map((ingredientId) => ({ userId, ingredientId })),
    }),
  ]);
  return getPantry(userId, lang);
};
