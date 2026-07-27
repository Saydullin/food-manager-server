import { Router } from 'express';
import * as adminIngredientController from '../../controllers/adminIngredientController';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import {
  addIngredientTranslationSchema,
  createIngredientSchema,
  ingredientIdParamSchema,
  listIngredientsQuerySchema,
} from '../../validation/adminIngredientSchemas';

export const adminIngredientRouter = Router();

adminIngredientRouter.get(
  '/',
  requireAdmin,
  validateQuery(listIngredientsQuerySchema),
  adminIngredientController.listIngredients,
);
adminIngredientRouter.post(
  '/',
  requireAdmin,
  validateBody(createIngredientSchema),
  adminIngredientController.createIngredient,
);
adminIngredientRouter.post(
  '/:id/translations',
  requireAdmin,
  validateParams(ingredientIdParamSchema),
  validateBody(addIngredientTranslationSchema),
  adminIngredientController.addTranslation,
);
