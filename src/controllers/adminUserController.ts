import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as adminUserService from '../services/adminUserService';

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = await adminUserService.listUsers({
    search: req.query.search as unknown as string | undefined,
    limit: req.query.limit as unknown as number,
    cursor: req.query.cursor as unknown as string | undefined,
  });
  res.status(200).json(page);
});

export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminUserService.getUserDetail(req.params.userId);
  res.status(200).json({ user });
});

export const banUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminUserService.setBanned(req.params.userId, true);
  res.status(200).json({ user });
});

export const unbanUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminUserService.setBanned(req.params.userId, false);
  res.status(200).json({ user });
});
