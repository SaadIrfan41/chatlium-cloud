import 'server-only';
import { createIdTokenVerifier, type VerifyIdToken } from '@chatlium/auth';
import * as oidc from 'openid-client';
import { config } from '../config.ts';
import { oidcConfig } from './oidc.ts';

let verifier: VerifyIdToken | undefined;

/** Verifies Cognito ID tokens against the pool's JWKS (@chatlium/auth, build guide 1.11). */
export function verifyIdToken(token: string): ReturnType<VerifyIdToken> {
  verifier ??= createIdTokenVerifier({
    issuer: config().COGNITO_ISSUER,
    clientId: config().COGNITO_CLIENT_ID,
  });
  return verifier(token);
}

/** Redeems a refresh token at Cognito's token endpoint, server-side with the client secret. */
export async function refreshTokens(
  refreshToken: string,
): Promise<{ idToken: string; refreshToken?: string }> {
  const tokens = await oidc.refreshTokenGrant(await oidcConfig(), refreshToken);
  if (tokens.id_token === undefined) {
    throw new Error('refresh returned no ID token');
  }
  return tokens.refresh_token === undefined
    ? { idToken: tokens.id_token }
    : { idToken: tokens.id_token, refreshToken: tokens.refresh_token };
}
