import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';

// Bootstraps (or updates) an admin account, since there's no self-signup flow.
// Usage: npm run admin:create -- <email> <password> <name>
async function main() {
  const [email, password, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ');

  if (!email || !password || !name) {
    console.error('Usage: npm run admin:create -- <email> <password> <name>');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash, name },
    update: { passwordHash, name },
  });

  console.log(`Admin ready: ${admin.email} (${admin.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
