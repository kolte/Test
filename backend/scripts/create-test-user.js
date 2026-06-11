// One-off helper: creates (or updates) a test user you can log into the
// desktop client with. There's no /auth/register endpoint or seed script in
// this scaffold (see auth.controller.ts / package.json), and login requires a
// User row whose `password` column matches the app's own hash format
// (`scrypt:N:r:p:saltHex:hashHex` — see src/auth/password.util.ts). This
// script reproduces that exact format so the row it creates is a normal,
// valid login the server will accept.
//
// Usage (from the backend/ folder):
//   node scripts/create-test-user.js you@example.com yourpassword "Your Name"

const { randomBytes, scrypt: scryptCallback } = require('crypto');
const { promisify } = require('util');
const { PrismaClient } = require('@prisma/client');

const scrypt = promisify(scryptCallback);

// Must match src/auth/password.util.ts exactly.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

async function hashPassword(plain) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return [PREFIX, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), derived.toString('hex')].join(':');
}

async function main() {
  const [, , email, password, name] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/create-test-user.js <email> <password> [name]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const hashed = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email },
      update: { password: hashed, name: name ?? undefined },
      create: { email, password: hashed, name: name ?? null },
      // organizationId/roles use schema defaults ("org-001" / ["employee"])
    });
    console.log(`User ready: ${user.email} (id: ${user.id})`);
    console.log('You can now log into the desktop client with that email/password.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
