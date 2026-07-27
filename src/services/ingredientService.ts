import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { pickByLanguage } from '../utils/i18n';
import { DEFAULT_LANGUAGE } from './foodService';

export interface IngredientView {
  id: string;
  name: string;
  availableLanguages: string[];
}

type IngredientRow = { id: string; translations: { language: string; name: string }[] };

const shapeIngredient = (row: IngredientRow, lang: string): IngredientView => ({
  id: row.id,
  name: pickByLanguage(row.translations, lang, DEFAULT_LANGUAGE)?.name ?? '',
  availableLanguages: row.translations.map((t) => t.language),
});

/**
 * The ingredient catalog, optionally filtered by name in **any** language (used
 * by the admin recipe form's picker). `name` on each result resolves to `lang`,
 * falling back to the default language then to whatever translation exists.
 * Ordered alphabetically by the resolved name — there's no admin-controlled
 * sortOrder like Diet/Cuisine since this catalog grows ad hoc rather than being
 * curated. Sorting happens in JS (not the DB) since the display name itself is
 * a per-row fallback computation Prisma can't order by directly; fine at the
 * existing 200-row cap.
 */
export const listIngredients = async (search?: string, lang: string = DEFAULT_LANGUAGE): Promise<IngredientView[]> => {
  const rows = await prisma.ingredient.findMany({
    where: search ? { translations: { some: { name: { contains: search, mode: 'insensitive' as const } } } } : {},
    include: { translations: { select: { language: true, name: true } } },
    take: 200,
  });
  return rows.map((r) => shapeIngredient(r, lang)).sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Adds a new ingredient to the catalog with its first translation. Name
 * uniqueness within a language is case-sensitive at the DB level, matching the
 * old Ingredient.name @unique behavior; a duplicate throws a 409 rather than
 * silently returning the existing row, since this is an explicit "create"
 * action from the admin panel (unlike resolveIngredientId's find-or-create used
 * while authoring a recipe).
 */
export const createIngredient = async (name: string, language: string = DEFAULT_LANGUAGE): Promise<IngredientView> => {
  const existing = await prisma.ingredient.findFirst({
    where: { translations: { some: { language, name } } },
    include: { translations: { select: { language: true, name: true } } },
  });
  if (existing) throw AppError.conflict(`Ingredient "${name}" already exists`, 'INGREDIENT_EXISTS');

  const row = await prisma.ingredient.create({
    data: { translations: { create: { language, name } } },
    include: { translations: { select: { language: true, name: true } } },
  });
  return shapeIngredient(row, language);
};

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Resolves a recipe-form ingredient line to a catalog ingredient id: uses
 * `ingredientId` directly when given (validating it exists), or finds/creates a
 * catalog row by `name` + `language` (case-insensitive match, scoped to that
 * language — there's no reliable way to know two different-language strings
 * name the same thing without an admin confirming it, see addIngredientTranslation)
 * when the admin typed a new ingredient inline. Runs inside the caller's
 * transaction so a new ingredient and the recipe that references it commit together.
 */
export const resolveIngredientId = async (
  tx: Tx,
  input: { ingredientId?: string; name?: string; language?: string },
): Promise<string> => {
  if (input.ingredientId) {
    const found = await tx.ingredient.findUnique({ where: { id: input.ingredientId } });
    if (!found) throw AppError.badRequest(`Unknown ingredientId: ${input.ingredientId}`, 'INVALID_INGREDIENT');
    return found.id;
  }

  const name = input.name!.trim();
  const language = input.language ?? DEFAULT_LANGUAGE;
  const existing = await tx.ingredient.findFirst({
    where: { translations: { some: { language, name: { equals: name, mode: 'insensitive' } } } },
  });
  if (existing) return existing.id;

  const created = await tx.ingredient.create({ data: { translations: { create: { language, name } } } });
  return created.id;
};

/**
 * Attaches a translation to an existing catalog ingredient — the operation
 * that lets an admin authoring in one language fill in the name of an
 * ingredient that so far only exists in another, instead of creating a
 * duplicate catalog row. Overwrites the ingredient's existing name for that
 * language if one was already set (treated as an edit, not a second entry).
 */
export const addIngredientTranslation = async (
  ingredientId: string,
  language: string,
  name: string,
): Promise<IngredientView> => {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient) throw AppError.notFound('Ingredient not found', 'INGREDIENT_NOT_FOUND');

  const claimedByOther = await prisma.ingredient.findFirst({
    where: {
      id: { not: ingredientId },
      translations: { some: { language, name: { equals: name, mode: 'insensitive' } } },
    },
  });
  if (claimedByOther) {
    throw AppError.conflict(
      `Another ingredient already has the ${language} name "${name}"`,
      'INGREDIENT_TRANSLATION_EXISTS',
    );
  }

  await prisma.ingredientTranslation.upsert({
    where: { ingredientId_language: { ingredientId, language } },
    create: { ingredientId, language, name },
    update: { name },
  });

  const row = await prisma.ingredient.findUniqueOrThrow({
    where: { id: ingredientId },
    include: { translations: { select: { language: true, name: true } } },
  });
  return shapeIngredient(row, language);
};
