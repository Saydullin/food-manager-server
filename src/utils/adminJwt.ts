import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AdminAccessTokenPayload {
  sub: string; // adminId
}

export const signAdminAccessToken = (payload: AdminAccessTokenPayload): string =>
  jwt.sign(payload, env.ADMIN_JWT_SECRET, {
    expiresIn: env.ADMIN_ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });

export const verifyAdminAccessToken = (token: string): AdminAccessTokenPayload =>
  jwt.verify(token, env.ADMIN_JWT_SECRET) as AdminAccessTokenPayload;
