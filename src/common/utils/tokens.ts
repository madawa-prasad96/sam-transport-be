import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Opaque token handed out in emails. Only its hash is ever stored. */
export const generateOpaqueToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const hmac = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');

/** Constant-time compare that never throws on length mismatch. */
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};
