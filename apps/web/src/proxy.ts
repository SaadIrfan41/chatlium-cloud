import { refreshIfStale } from '@chatlium/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { cookieOptions, SESSION_TTL_SECONDS, sessions } from '@/server/auth/cookies';
import { refreshTokens, verifyIdToken } from '@/server/auth/tokens';
import { log } from '@/server/config';

/**
 * Keeps sessions tied to a live Cognito sign-in (decision record §2: tokens last 15 minutes and
 * are refreshed on the server). Runs before pages and API routes. While the session's ID token is
 * valid it does nothing. After that it refreshes server-side and re-verifies the new ID token; if
 * Cognito refuses (user disabled, globally signed out, token revoked) the session cookie is
 * removed, so the page sees a signed-out user.
 *
 * Authorization still happens where data is read (requireSession and membership checks). This is
 * session maintenance, not an access check.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const name = sessions().cookieName;
  const session = await sessions().read(request.cookies.get(name)?.value);
  if (session === undefined) {
    return NextResponse.next();
  }

  const outcome = await refreshIfStale(session, { refresh: refreshTokens, verifyIdToken });
  if (outcome.status === 'fresh') {
    return NextResponse.next();
  }

  if (outcome.status === 'ended') {
    request.cookies.delete(name);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.delete(name);
    log().info({ event: 'session.ended' }, 'session ended: refresh refused');
    return response;
  }

  // Pass the refreshed session to this request's rendering, and store it in the browser.
  const sealed = await sessions().seal(outcome.session);
  request.cookies.set(name, sealed);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(name, sealed, cookieOptions(SESSION_TTL_SECONDS));
  log().info({ event: 'session.refreshed' }, 'session refreshed');
  return response;
}

export const config = {
  // Everything except static assets and the sign-in/sign-out routes themselves.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth/).*)'],
};
