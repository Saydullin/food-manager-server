import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as adminFoodService from '../services/adminFoodService';

export const listFoods = asyncHandler(async (req: Request, res: Response) => {
  const page = await adminFoodService.listFoods({
    search: req.query.search as unknown as string | undefined,
    limit: req.query.limit as unknown as number,
    cursor: req.query.cursor as unknown as string | undefined,
  });
  res.status(200).json(page);
});

export const createFood = asyncHandler(async (req: Request, res: Response) => {
  const food = await adminFoodService.createFood(req.body);
  res.status(201).json({ food });
});

export const updateFood = asyncHandler(async (req: Request, res: Response) => {
  const food = await adminFoodService.updateFood(req.params.foodId, req.body);
  res.status(200).json({ food });
});

export const deleteFood = asyncHandler(async (req: Request, res: Response) => {
  await adminFoodService.deleteFood(req.params.foodId);
  res.status(204).send();
});
