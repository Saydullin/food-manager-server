import { Router } from 'express';
import { env } from '../config/env';
import { authRouter } from './authRoutes';
import { devRouter } from './devRoutes';
import { userRouter } from './userRoutes';
import { dietRouter } from './dietRoutes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/diets', dietRouter);

if (env.NODE_ENV !== 'production') {
  apiRouter.use('/dev', devRouter);
}
