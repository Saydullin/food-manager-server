import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as adminUserService from '../services/adminUserService';

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminUserService.listUsers({
    search: req.query.search as unknown as string | undefined,
    page: req.query.page as unknown as number,
    pageSize: req.query.pageSize as unknown as number,
  });
  res.status(200).json(result);
});

export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminUserService.getUserDetail(req.params.userId);
  res.status(200).json({ user });
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminUserService.setStatus(req.params.userId, req.body.status);
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
