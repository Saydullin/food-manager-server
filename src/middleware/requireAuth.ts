import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string; deviceId: string };
}

/** Requires a valid `Authorization: Bearer <accessToken>` header; attaches `req.auth`. */
export const requireAuth = (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    throw AppError.unauthorized('Missing or malformed Authorization header');
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, deviceId: payload.deviceId };
    next();
  } catch {
    throw AppError.unauthorized('Invalid or expired access token', 'INVALID_TOKEN');
  }
};
