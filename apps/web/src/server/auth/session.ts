import 'server-only';
import { UnauthenticatedError, type SessionUser } from '@chatlium/auth';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { sessions } from './cookies.ts';

/**
 * The signed-in user, or undefined. Server Components and Server Functions use this; Route
 * Handlers call `sessions().requireSession(request)` directly. The proxy (src/proxy.ts) has
 * already refreshed a stale session for this request. Cached for the duration of one request.
 */
export const getSession = cache(async (): Promise<SessionUser | undefined> => {
  const sealed = (await cookies()).get(sessions().cookieName)?.value;
  const session = await sessions().read(sealed);
  if (session === undefined) {
    return undefined;
  }
  return {
    userId: session.userId,
    cognitoSub: session.cognitoSub,
    email: session.email,
    csrf: session.csrf,
  };
});

/** Like getSession, but throws UnauthenticatedError when nobody is signed in. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSession();
  if (user === undefined) {
    throw new UnauthenticatedError();
  }
  return user;
}
