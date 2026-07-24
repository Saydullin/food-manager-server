import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string; deviceId: string };
}

/**
 * Requires a valid `Authorization: Bearer <accessToken>` header; attaches `req.auth`.
 * Also rejects a banned account outright — an admin ban must take effect immediately
 * on every route, not just at login, so this is the one shared checkpoint every
 * authenticated request passes through.
 */
export const requireAuth = (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    next(AppError.unauthorized('Missing or malformed Authorization header'));
    return;
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    next(AppError.unauthorized('Invalid or expired access token', 'INVALID_TOKEN'));
    return;
  }

  // Async DB check (is the account banned?) — Express 4 doesn't await middleware,
  // so this runs as its own promise chain with errors routed to next() explicitly,
  // same pattern asyncHandler applies to route handlers.
  prisma.user
    .findUnique({ where: { id: payload.sub }, select: { isBanned: true } })
    .then((user) => {
      if (user?.isBanned) {
        next(AppError.forbidden('This account has been suspended', 'ACCOUNT_BANNED'));
        return;
      }
      req.auth = { userId: payload.sub, deviceId: payload.deviceId };
      next();
    })
    .catch(next);
};
