import { randomBytes, scrypt as scryptCallback, ScryptOptions, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

// `crypto.scrypt` is overloaded (with/without an options object), which
// confuses `promisify`'s overload resolution and makes it pick the
// 3-argument signature. Cast to the 4-argument shape we actually call.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// scrypt cost parameters. N must be a power of two; these are Node's
// documented defaults for interactive logins (~16MB memory, suitable for
// a login endpoint without a dedicated hashing service like bcrypt/argon2).
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

const PREFIX = 'scrypt';

/**
 * Hashes a plaintext password into a self-describing string of the form
 * `scrypt:N:r:p:saltHex:hashHex` so the cost parameters travel with the hash
 * (and can be tuned later without breaking previously-stored values).
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [PREFIX, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), derived.toString('hex')].join(':');
}

/**
 * Verifies a plaintext password against a hash produced by `hashPassword`.
 * Uses the cost parameters embedded in the stored hash (rather than the
 * current constants) so existing hashes keep working if the constants above
 * are tuned in the future, and compares digests with a constant-time
 * comparison to avoid leaking timing information.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return false;
  }

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  const derived = await scrypt(plain, salt, expected.length, { N, r, p });
  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}
