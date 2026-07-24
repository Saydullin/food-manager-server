import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as adminAuthService from '../services/adminAuthService';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const session = await adminAuthService.login(req.body);
  res.status(200).json(session);
});
