import { Router } from 'express';
import { adminAuthRouter } from './adminAuthRoutes';
import { adminFoodRouter } from './adminFoodRoutes';
import { adminIngredientRouter } from './adminIngredientRoutes';
import { adminUserRouter } from './adminUserRoutes';
import { adminComplaintRouter } from './adminComplaintRoutes';
import { adminMetaRouter } from './adminMetaRoutes';
import { adminUploadRouter } from './adminUploadRoutes';

export const adminRouter = Router();

// Login is the only unauthenticated admin route; every other sub-router applies
// requireAdmin per-route itself (matching the per-route auth style userRouter etc. use).
adminRouter.use('/auth', adminAuthRouter);
adminRouter.use('/foods', adminFoodRouter);
adminRouter.use('/ingredients', adminIngredientRouter);
adminRouter.use('/users', adminUserRouter);
adminRouter.use('/complaints', adminComplaintRouter);
adminRouter.use('/meta', adminMetaRouter);
adminRouter.use('/uploads', adminUploadRouter);
