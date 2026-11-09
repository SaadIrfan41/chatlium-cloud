import { timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieName, sessions, sessionSchema } from '@/server/auth/cookies';
import { logoutUrl, oidcConfig } from '@/server/auth/oidc';
import { config, log } from '@/server/config';

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Signs out. A state-changing request, so it requires a trusted Origin header and the session's
 * CSRF token (amendments §2; SameSite=Lax alone is not relied on). Revokes the refresh token,
 * clears the session cookie, then sends the browser to Cognito's sign-out, which returns to `/`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('origin') !== new URL(config().APP_BASE_URL).origin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sealed = request.cookies.get(sessionCookieName())?.value;
  const session = sealed === undefined ? undefined : await sessions().unseal(sealed, sessionSchema);
  if (session === undefined) {
    return NextResponse.redirect(new URL('/', config().APP_BASE_URL), 303);
  }

  const submitted = (await request.formData()).get('csrf');
  if (typeof submitted !== 'string' || !sameToken(submitted, session.csrf)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (session.refreshToken !== undefined) {
    try {
      await oidc.tokenRevocation(await oidcConfig(), session.refreshToken);
    } catch (error) {
      // Sign-out must still complete; the cookie is cleared either way.
      log().warn(
        {
          event: 'signout.revoke_failed',
          error_category: error instanceof Error ? error.name : 'unknown',
        },
        'refresh token revocation failed',
      );
    }
  }

  const response = NextResponse.redirect(await logoutUrl(), 303);
  response.cookies.delete(sessionCookieName());
  log().info({ event: 'signout.succeeded' }, 'signed out');
  return response;
}
