import { Router } from 'express';
import * as cuisineController from '../controllers/cuisineController';
import { requireAuth } from '../middleware/requireAuth';

export const cuisineRouter = Router();

// The cuisine catalog is server-owned reference data. Protected with requireAuth so,
// like every other request, it carries a valid access token.
cuisineRouter.get('/', requireAuth, cuisineController.listCuisines);
