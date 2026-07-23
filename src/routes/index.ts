import { Router } from 'express';
import { env } from '../config/env';
import { authRouter } from './authRoutes';
import { devRouter } from './devRoutes';
import { userRouter } from './userRoutes';
import { dietRouter } from './dietRoutes';
import { cuisineRouter } from './cuisineRoutes';
import { foodRouter } from './foodRoutes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/diets', dietRouter);
apiRouter.use('/cuisines', cuisineRouter);
apiRouter.use('/foods', foodRouter);

if (env.NODE_ENV !== 'production') {
  apiRouter.use('/dev', devRouter);
}
