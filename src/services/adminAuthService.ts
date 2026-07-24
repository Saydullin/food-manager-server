import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/errors';
import { signAdminAccessToken } from '../utils/adminJwt';

export interface AdminLoginInput {
  email: string;
  password: string;
}

export interface AdminSession {
  accessToken: string;
  admin: { id: string; email: string; name: string };
}

/** Generic error on any mismatch — don't leak whether the email or password was wrong. */
export const login = async ({ email, password }: AdminLoginInput): Promise<AdminSession> => {
  const invalidCredentials = () =>
    AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw invalidCredentials();

  const passwordMatches = await bcrypt.compare(password, admin.passwordHash);
  if (!passwordMatches) throw invalidCredentials();

  const accessToken = signAdminAccessToken({ sub: admin.id });
  return { accessToken, admin: { id: admin.id, email: admin.email, name: admin.name } };
};
