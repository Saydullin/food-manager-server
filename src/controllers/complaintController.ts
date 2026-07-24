import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as complaintService from '../services/complaintService';
import type { AuthenticatedRequest } from '../middleware/requireAuth';

// POST /complaints — an app user reports another user or a dish.
export const fileComplaint = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const complaint = await complaintService.fileComplaint(req.auth!.userId, req.body);
  res.status(201).json({ complaint });
});
