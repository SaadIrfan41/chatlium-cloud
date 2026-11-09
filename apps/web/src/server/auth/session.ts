import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { sessionCookieName, sessions, sessionSchema, type Session } from './cookies.ts';

/**
 * The signed-in user, or undefined. Reads and unseals the session cookie; a tampered, expired or
 * foreign cookie counts as signed out. Cached for the duration of one request.
 * Step 1.11 adds ID-token verification on refresh and the application user ID.
 */
export const getSession = cache(async (): Promise<Session | undefined> => {
  const sealed = (await cookies()).get(sessionCookieName())?.value;
  if (sealed === undefined) {
    return undefined;
  }
  return sessions().unseal(sealed, sessionSchema);
});
