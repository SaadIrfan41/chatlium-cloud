import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

export interface IdTokenVerifierOptions {
  /** Expected `iss`, e.g. `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbC123`. */
  readonly issuer: string;
  /** The app client ID: Cognito ID tokens carry it as `aud`. */
  readonly clientId: string;
  /** Key source. Defaults to `<issuer>/.well-known/jwks.json` (cached and refreshed by jose). */
  readonly keys?: JWTVerifyGetKey;
  /** Allowed clock skew between this server and Cognito. */
  readonly clockToleranceSeconds?: number;
}

/** The claims Chatlium relies on from a verified Cognito ID token. */
export interface IdTokenClaims {
  readonly sub: string;
  readonly email: string;
  /** Seconds since the epoch. */
  readonly exp: number;
}

/** Thrown for any token that fails verification. The reason is safe to log; the token never is. */
export class InvalidIdTokenError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Invalid ID token: ${reason}`, options);
    this.name = 'InvalidIdTokenError';
  }
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  exp: z.number(),
  token_use: z.literal('id'),
});

/**
 * Verifies Cognito ID tokens (build guide 1.11): the RS256 signature against the pool's JWKS,
 * `iss`, `aud` (the app client ID), `exp`, and Cognito's `token_use`, which must be `id` so an
 * access token is never accepted in its place. `nonce` is checked once, at sign-in, by the
 * OIDC client.
 */
export function createIdTokenVerifier(options: IdTokenVerifierOptions) {
  const keys =
    options.keys ??
    createRemoteJWKSet(new URL(`${options.issuer.replace(/\/$/, '')}/.well-known/jwks.json`));

  return async function verifyIdToken(token: string): Promise<IdTokenClaims> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: options.issuer,
        audience: options.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: options.clockToleranceSeconds ?? 5,
      }));
    } catch (error) {
      const reason =
        error instanceof Error && 'code' in error ? String(error.code) : 'unverifiable';
      throw new InvalidIdTokenError(reason, { cause: error });
    }

    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new InvalidIdTokenError('not an ID token, or missing sub or email');
    }
    return { sub: claims.data.sub, email: claims.data.email, exp: claims.data.exp };
  };
}

export type VerifyIdToken = ReturnType<typeof createIdTokenVerifier>;
