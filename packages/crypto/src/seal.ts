import { hkdfSync } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import type { z } from 'zod';

/**
 * Sealed values: encrypted and authenticated with AES-256-GCM (compact JWE, `dir` + `A256GCM`).
 *
 * Each purpose (for example `session` or `auth-transaction`) gets its own key, derived with HKDF
 * from the sealing secret, so a value sealed for one purpose never unseals as another. Expiry is
 * part of the encrypted payload, so it cannot be changed without breaking the authentication tag.
 */
export interface Sealer {
  seal(payload: Readonly<Record<string, unknown>>, ttlSeconds: number): Promise<string>;
  /** Returns undefined for anything tampered, expired, sealed with another key or purpose, or malformed. */
  unseal<T>(sealed: string, schema: z.ZodType<T>): Promise<T | undefined>;
}

const MIN_SECRET_LENGTH = 32;

export function createSealer(
  secret: string,
  purpose: string,
  now: () => Date = () => new Date(),
): Sealer {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`sealing secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (purpose === '') {
    throw new Error('sealing purpose must not be empty');
  }
  const key = new Uint8Array(hkdfSync('sha256', secret, 'chatlium-seal-v1', purpose, 32));
  const audience = `chatlium:${purpose}`;

  return {
    async seal(payload, ttlSeconds) {
      const issuedAt = Math.floor(now().getTime() / 1000);
      return new EncryptJWT({ ...payload })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .encrypt(key);
    },
    async unseal(sealed, schema) {
      try {
        const { payload } = await jwtDecrypt(sealed, key, {
          audience,
          currentDate: now(),
          keyManagementAlgorithms: ['dir'],
          contentEncryptionAlgorithms: ['A256GCM'],
        });
        const { aud: _aud, iat: _iat, exp: _exp, ...claims } = payload;
        const parsed = schema.safeParse(claims);
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
