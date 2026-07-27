import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as ingredientService from '../services/ingredientService';
import { DEFAULT_LANGUAGE } from '../services/foodService';

export const listIngredients = asyncHandler(async (req: Request, res: Response) => {
  const ingredients = await ingredientService.listIngredients(
    req.query.search as unknown as string | undefined,
    (req.query.lang as unknown as string | undefined) ?? DEFAULT_LANGUAGE,
  );
  res.status(200).json({ ingredients });
});

export const createIngredient = asyncHandler(async (req: Request, res: Response) => {
  const ingredient = await ingredientService.createIngredient(req.body.name, req.body.language);
  res.status(201).json({ ingredient });
});

export const addTranslation = asyncHandler(async (req: Request, res: Response) => {
  const ingredient = await ingredientService.addIngredientTranslation(
    req.params.id as string,
    req.body.language,
    req.body.name,
  );
  res.status(200).json({ ingredient });
});
