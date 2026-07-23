import { Router } from 'express';
import * as dietController from '../controllers/dietController';
import { requireAuth } from '../middleware/requireAuth';

export const dietRouter = Router();

// The diet catalog is server-owned reference data. Protected with requireAuth so,
// like every other request, it carries a valid access token.
dietRouter.get('/', requireAuth, dietController.listDiets);
