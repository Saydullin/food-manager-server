import { Router } from 'express';
import { env } from '../config/env';
import { authRouter } from './authRoutes';
import { devRouter } from './devRoutes';
import { userRouter } from './userRoutes';
import { dietRouter } from './dietRoutes';
import { cuisineRouter } from './cuisineRoutes';
import { foodRouter } from './foodRoutes';
import { uploadRouter } from './uploadRoutes';
import { complaintRouter } from './complaintRoutes';
import { adminRouter } from './admin';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/diets', dietRouter);
apiRouter.use('/cuisines', cuisineRouter);
apiRouter.use('/foods', foodRouter);
apiRouter.use('/uploads', uploadRouter);
apiRouter.use('/complaints', complaintRouter);
apiRouter.use('/admin', adminRouter);

if (env.NODE_ENV !== 'production') {
  apiRouter.use('/dev', devRouter);
}
