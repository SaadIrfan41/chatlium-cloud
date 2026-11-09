import * as oidc from 'openid-client';
import { NextResponse } from 'next/server';
import {
  cookieOptions,
  transactionCookieName,
  transactions,
  TRANSACTION_TTL_SECONDS,
} from '@/server/auth/cookies';
import { callbackUrl, oidcConfig } from '@/server/auth/oidc';

/**
 * Starts sign-in: a fresh PKCE verifier, state and nonce for every attempt, kept in a short-lived
 * sealed cookie, then a redirect to Cognito's hosted sign-in.
 */
export async function GET(): Promise<NextResponse> {
  const configuration = await oidcConfig();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const authorize = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: callbackUrl().toString(),
    scope: 'openid email profile',
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  const response = NextResponse.redirect(authorize);
  response.cookies.set(
    transactionCookieName(),
    await transactions().seal({ state, nonce, codeVerifier }, TRANSACTION_TTL_SECONDS),
    cookieOptions(TRANSACTION_TTL_SECONDS),
  );
  return response;
}
