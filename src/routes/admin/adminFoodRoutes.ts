import { Router } from 'express';
import * as adminFoodController from '../../controllers/adminFoodController';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import {
  createFoodSchema,
  foodIdParamSchema,
  listFoodsQuerySchema,
  updateFoodSchema,
} from '../../validation/adminFoodSchemas';

export const adminFoodRouter = Router();

adminFoodRouter.get('/', requireAdmin, validateQuery(listFoodsQuerySchema), adminFoodController.listFoods);
adminFoodRouter.post('/', requireAdmin, validateBody(createFoodSchema), adminFoodController.createFood);
adminFoodRouter.patch(
  '/:foodId',
  requireAdmin,
  validateParams(foodIdParamSchema),
  validateBody(updateFoodSchema),
  adminFoodController.updateFood,
);
adminFoodRouter.delete(
  '/:foodId',
  requireAdmin,
  validateParams(foodIdParamSchema),
  adminFoodController.deleteFood,
);
