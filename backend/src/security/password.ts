import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PREFIX = 'scrypt$v1$32768$8$3';
const FORMAT = /^scrypt\$v1\$32768\$8\$3\$([0-9a-f]{32})\$([0-9a-f]{128})$/;
// Equal-cost verification for absent accounts/unsupported hashes; not a credential.
const dummy = `${PREFIX}$${randomBytes(16).toString('hex')}$${randomBytes(64).toString('hex')}`;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}

export function validPasswordInput(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && Buffer.byteLength(value, 'utf8') <= 1024;
}

/** Offline helper for an explicitly approved provisioning procedure; does not persist anything. */
export async function hashPassword(password: string): Promise<string> {
  if (!validPasswordInput(password) || password.length < 12) throw new Error('A senha deve ter de 12 a 256 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return `${PREFIX}$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  if (!validPasswordInput(password)) return false;
  const valid = typeof hash === 'string' ? FORMAT.exec(hash) : null;
  const match = valid ?? FORMAT.exec(dummy)!;
  const actual = await derive(password, match[1]!);
  return timingSafeEqual(actual, Buffer.from(match[2]!, 'hex')) && valid !== null;
}
