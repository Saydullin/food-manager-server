import { Router } from 'express';
import * as adminComplaintController from '../../controllers/adminComplaintController';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import {
  complaintIdParamSchema,
  listComplaintsQuerySchema,
  resolveComplaintSchema,
} from '../../validation/complaintSchemas';

export const adminComplaintRouter = Router();

adminComplaintRouter.get(
  '/',
  requireAdmin,
  validateQuery(listComplaintsQuerySchema),
  adminComplaintController.listComplaints,
);
adminComplaintRouter.patch(
  '/:complaintId',
  requireAdmin,
  validateParams(complaintIdParamSchema),
  validateBody(resolveComplaintSchema),
  adminComplaintController.resolveComplaint,
);
