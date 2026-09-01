import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password === 'change-this-before-seeding') {
    throw new Error('Set a real ADMIN_EMAIL and ADMIN_PASSWORD before seeding.');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true },
    create: { email, passwordHash, role: UserRole.ADMIN },
  });
  console.log(`Admin account ready: ${email}`);
}

main()
  .finally(() => prisma.$disconnect());
