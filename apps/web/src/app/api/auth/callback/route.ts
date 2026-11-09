import { randomBytes } from 'node:crypto';
import { upsertUserByCognitoSub } from '@chatlium/db';
import * as oidc from 'openid-client';
import { NextResponse, type NextRequest } from 'next/server';
import {
  cookieOptions,
  SESSION_TTL_SECONDS,
  sessions,
  transactionCookieName,
  transactions,
  transactionSchema,
} from '@/server/auth/cookies';
import { callbackUrl, oidcConfig } from '@/server/auth/oidc';
import { verifyIdToken } from '@/server/auth/tokens';
import { config, log } from '@/server/config';
import { db } from '@/server/db';

function backToSignIn(reason: 'expired' | 'cancelled' | 'failed'): NextResponse {
  const url = new URL('/', config().APP_BASE_URL);
  url.searchParams.set('signin', reason);
  const response = NextResponse.redirect(url, 303);
  response.cookies.delete(transactionCookieName());
  return response;
}

/**
 * Finishes sign-in. Checks `state` against the sealed transaction and redeems the code on the
 * server with the PKCE verifier and client secret; openid-client verifies the ID token's
 * signature, `iss`, `aud`, `exp` and `nonce`. The same token is then verified by @chatlium/auth
 * (signature, `iss`, `aud`, `exp`, `token_use`), the path every later refresh also takes. The
 * application user is created on first sign-in, and only then is the sealed session set.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sealed = request.cookies.get(transactionCookieName())?.value;
  const transaction =
    sealed === undefined ? undefined : await transactions().unseal(sealed, transactionSchema);
  if (transaction === undefined) {
    return backToSignIn('expired');
  }
  if (request.nextUrl.searchParams.has('error')) {
    return backToSignIn('cancelled');
  }

  // The callback URL comes from configuration plus this request's query, never from its Host header.
  const currentUrl = callbackUrl();
  currentUrl.search = request.nextUrl.search;

  try {
    const tokens = await oidc.authorizationCodeGrant(await oidcConfig(), currentUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
    if (tokens.id_token === undefined) {
      throw new Error('token response has no ID token');
    }
    const claims = await verifyIdToken(tokens.id_token);
    const userId = await upsertUserByCognitoSub(db(), {
      cognitoSub: claims.sub,
      email: claims.email,
    });

    const session = await sessions().seal({
      userId,
      cognitoSub: claims.sub,
      email: claims.email,
      csrf: randomBytes(32).toString('base64url'),
      idTokenExpiresAt: claims.exp,
      ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
    });
    const response = NextResponse.redirect(new URL('/dashboard', config().APP_BASE_URL), 303);
    response.cookies.set(sessions().cookieName, session, cookieOptions(SESSION_TTL_SECONDS));
    response.cookies.delete(transactionCookieName());
    log().info({ event: 'signin.succeeded' }, 'sign-in completed');
    return response;
  } catch (error) {
    log().warn(
      { event: 'signin.failed', error_category: error instanceof Error ? error.name : 'unknown' },
      'sign-in failed',
    );
    return backToSignIn('failed');
  }
}
