import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as complaintService from '../services/complaintService';
import type { AdminAuthenticatedRequest } from '../middleware/requireAdmin';

export const listComplaints = asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
  const page = await complaintService.listComplaints({
    status: req.query.status as unknown as complaintService.ListComplaintsParams['status'],
    limit: req.query.limit as unknown as number,
    cursor: req.query.cursor as unknown as string | undefined,
  });
  res.status(200).json(page);
});

export const resolveComplaint = asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
  const complaint = await complaintService.resolveComplaint(
    req.admin!.adminId,
    req.params.complaintId,
    req.body.status,
  );
  res.status(200).json({ complaint });
});
