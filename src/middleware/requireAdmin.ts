import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { verifyAdminAccessToken } from '../utils/adminJwt';

export interface AdminAuthenticatedRequest extends Request {
  admin?: { adminId: string };
}

/** Requires a valid admin `Authorization: Bearer <accessToken>` header; attaches `req.admin`. */
export const requireAdmin = (req: AdminAuthenticatedRequest, _res: Response, next: NextFunction): void => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    throw AppError.unauthorized('Missing or malformed Authorization header');
  }

  try {
    const payload = verifyAdminAccessToken(token);
    req.admin = { adminId: payload.sub };
    next();
  } catch {
    throw AppError.unauthorized('Invalid or expired access token', 'INVALID_TOKEN');
  }
};
