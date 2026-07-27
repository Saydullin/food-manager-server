import { Router } from 'express';
import * as adminMetaController from '../../controllers/adminMetaController';
import { requireAdmin } from '../../middleware/requireAdmin';

export const adminMetaRouter = Router();

adminMetaRouter.get('/food-form-options', requireAdmin, adminMetaController.getFoodFormOptions);
adminMetaRouter.get('/labels', requireAdmin, adminMetaController.getLabels);
