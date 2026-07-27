import { Router } from 'express';
import * as catalogController from '../controllers/catalogController';
import { requireAuth } from '../middleware/requireAuth';

export const catalogRouter = Router();

// Server-owned label dictionary for the fixed tag catalogs. Protected with
// requireAuth, same as the cuisine/diet catalogs, so it carries a valid access
// token like every other request.
catalogRouter.get('/labels', requireAuth, catalogController.getLabels);
