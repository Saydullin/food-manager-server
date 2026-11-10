import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as householdService from '../services/householdService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

// GET /users/me/household/eaters — the people the user cooks for, in the order added.
export const listEaters = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const eaters = await householdService.listEaters(req.auth!.userId);
  res.status(200).json({ eaters });
});

// PUT /users/me/household/eaters/:eaterId — create or fully replace (idempotent).
export const putEater = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const eater = await householdService.putEater(req.auth!.userId, req.params.eaterId, req.body);
  res.status(200).json({ eater });
});

// DELETE /users/me/household/eaters/:eaterId — idempotent.
export const deleteEater = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await householdService.deleteEater(req.auth!.userId, req.params.eaterId);
  res.status(200).json(result);
});

// GET /users/me/kitchen — `appliances: null` means the user was never asked.
export const getKitchen = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const kitchen = await householdService.getKitchen(req.auth!.userId);
  res.status(200).json({ kitchen });
});

// PUT /users/me/kitchen — replaces the appliance list in full.
export const putKitchen = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const kitchen = await householdService.setKitchen(req.auth!.userId, req.body.appliances);
  res.status(200).json({ kitchen });
});

// GET /users/me/pantry — what the user has at home.
export const getPantry = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const items = await householdService.getPantry(
    req.auth!.userId,
    req.query.lang as unknown as string | undefined,
  );
  res.status(200).json({ items });
});

// PUT /users/me/pantry — replaces the pantry in full.
export const putPantry = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const items = await householdService.setPantry(
    req.auth!.userId,
    req.body.ingredientIds,
    req.query.lang as unknown as string | undefined,
  );
  res.status(200).json({ items });
});
