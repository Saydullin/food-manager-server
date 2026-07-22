import { Router } from 'express';
import { env } from '../config/env';
import { authRouter } from './authRoutes';
import { devRouter } from './devRoutes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);

if (env.NODE_ENV !== 'production') {
  apiRouter.use('/dev', devRouter);
}
