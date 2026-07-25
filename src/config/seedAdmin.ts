import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

const DEFAULT_ADMIN_EMAIL = 'saydullindev@gmail.com';
const DEFAULT_ADMIN_PASSWORD = 'say';
const DEFAULT_ADMIN_NAME = 'Saydullin';

/** Ensures a default admin account always exists, for local/dev convenience. */
export const seedDefaultAdmin = async (): Promise<void> => {
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

  await prisma.adminUser.upsert({
    where: { email: DEFAULT_ADMIN_EMAIL },
    create: { email: DEFAULT_ADMIN_EMAIL, passwordHash, name: DEFAULT_ADMIN_NAME },
    update: { passwordHash, name: DEFAULT_ADMIN_NAME },
  });
};
