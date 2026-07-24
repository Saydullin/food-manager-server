import { Router } from 'express';
import * as complaintController from '../controllers/complaintController';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody } from '../middleware/validate';
import { fileComplaintSchema } from '../validation/complaintSchemas';

export const complaintRouter = Router();

complaintRouter.post('/', requireAuth, validateBody(fileComplaintSchema), complaintController.fileComplaint);
