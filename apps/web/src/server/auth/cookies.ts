import 'server-only';
import { createSessionStore, type SessionStore } from '@chatlium/auth';
import { createSealer, type Sealer } from '@chatlium/crypto';
import { z } from 'zod';
import { config } from '../config.ts';

/** Seven days, matching the Cognito refresh token lifetime (Step 1.9). */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Long enough to sign in, short enough that an abandoned sign-in expires quickly. */
export const TRANSACTION_TTL_SECONDS = 10 * 60;

/**
 * `__Host-` cookies must be Secure, so the prefix is used only over HTTPS. Locally the app runs on
 * http://localhost, where browsers would reject a `__Host-` cookie.
 */
function isSecure(): boolean {
  return new URL(config().APP_BASE_URL).protocol === 'https:';
}

export function sessionCookieName(): string {
  return isSecure() ? '__Host-chatlium_session' : 'chatlium_session';
}

export function transactionCookieName(): string {
  return isSecure() ? '__Host-chatlium_signin' : 'chatlium_signin';
}

export interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge: number;
}

/** HttpOnly, Secure over HTTPS, SameSite=Lax (decision record §2, amendments §2). */
export function cookieOptions(maxAge: number): CookieOptions {
  return { httpOnly: true, secure: isSecure(), sameSite: 'lax', path: '/', maxAge };
}

/** The in-progress sign-in: what the callback must check. */
export const transactionSchema = z.object({
  state: z.string().min(16),
  nonce: z.string().min(16),
  codeVerifier: z.string().min(43),
});

let sessionStore: SessionStore | undefined;
let transactionSealer: Sealer | undefined;

/** Sealing, reading and requireSession for the session cookie (@chatlium/auth). */
export function sessions(): SessionStore {
  sessionStore ??= createSessionStore({
    sealer: createSealer(config().SESSION_SEALING_KEY, 'session'),
    cookieName: sessionCookieName(),
    ttlSeconds: SESSION_TTL_SECONDS,
  });
  return sessionStore;
}

export function transactions(): Sealer {
  transactionSealer ??= createSealer(config().SESSION_SEALING_KEY, 'signin-transaction');
  return transactionSealer;
}
