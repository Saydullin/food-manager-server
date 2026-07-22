import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as deviceService from '../services/deviceService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

export const addDevice = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await deviceService.addDevice(req.auth!.userId, req.body);
  res.status(201).json(result);
});

export const listDevices = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await deviceService.listDevices(req.auth!.userId);
  res.status(200).json(result);
});

export const revokeDevice = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await deviceService.revokeDevice(req.auth!.userId, req.params.deviceId);
  res.status(200).json({ message: 'Device revoked' });
});
