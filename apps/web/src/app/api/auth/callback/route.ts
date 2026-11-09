import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { NextResponse, type NextRequest } from 'next/server';
import {
  cookieOptions,
  sessionCookieName,
  sessions,
  SESSION_TTL_SECONDS,
  transactionCookieName,
  transactions,
  transactionSchema,
} from '@/server/auth/cookies';
import { callbackUrl, oidcConfig } from '@/server/auth/oidc';
import { config, log } from '@/server/config';

function backToSignIn(reason: 'expired' | 'cancelled' | 'failed'): NextResponse {
  const url = new URL('/', config().APP_BASE_URL);
  url.searchParams.set('signin', reason);
  const response = NextResponse.redirect(url, 303);
  response.cookies.delete(transactionCookieName());
  return response;
}

/**
 * Finishes sign-in. Checks state against the sealed transaction, redeems the code on the server
 * with the PKCE verifier and the client secret, and verifies the ID token: openid-client checks
 * the signature, `iss`, `aud`, `exp` and `nonce`; Cognito's `token_use` is checked here.
 * Only then is the sealed session cookie created. No token is ever sent to the browser.
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
    const claims = tokens.claims();
    if (
      claims === undefined ||
      claims['token_use'] !== 'id' ||
      typeof claims['email'] !== 'string'
    ) {
      throw new Error('ID token is missing token_use=id or email');
    }

    const session = await sessions().seal(
      {
        sub: claims.sub,
        email: claims['email'],
        csrf: randomBytes(32).toString('base64url'),
        ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
      },
      SESSION_TTL_SECONDS,
    );
    const response = NextResponse.redirect(new URL('/dashboard', config().APP_BASE_URL), 303);
    response.cookies.set(sessionCookieName(), session, cookieOptions(SESSION_TTL_SECONDS));
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
