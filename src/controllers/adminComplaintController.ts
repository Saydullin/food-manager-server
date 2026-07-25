import type { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as complaintService from '../services/complaintService';
import type { AdminAuthenticatedRequest } from '../middleware/requireAdmin';

export const listComplaints = asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
  const result = await complaintService.listComplaints({
    status: req.query.status as unknown as complaintService.ListComplaintsParams['status'],
    page: req.query.page as unknown as number,
    pageSize: req.query.pageSize as unknown as number,
  });
  res.status(200).json(result);
});

export const resolveComplaint = asyncHandler(async (req: AdminAuthenticatedRequest, res: Response) => {
  const complaint = await complaintService.resolveComplaint(
    req.admin!.adminId,
    req.params.complaintId,
    req.body.status,
  );
  res.status(200).json({ complaint });
});
