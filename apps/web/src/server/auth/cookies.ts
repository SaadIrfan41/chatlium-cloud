import 'server-only';
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

/** What the session cookie holds. No access or ID token is kept; the refresh token never leaves the server. */
export const sessionSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  /** Synchronizer token for state-changing form posts (amendments §2). */
  csrf: z.string().min(16),
  refreshToken: z.string().min(1).optional(),
});
export type Session = z.infer<typeof sessionSchema>;

/** The in-progress sign-in: what the callback must check. */
export const transactionSchema = z.object({
  state: z.string().min(16),
  nonce: z.string().min(16),
  codeVerifier: z.string().min(43),
});
export type SignInTransaction = z.infer<typeof transactionSchema>;

let sessionSealer: Sealer | undefined;
let transactionSealer: Sealer | undefined;

export function sessions(): Sealer {
  sessionSealer ??= createSealer(config().SESSION_SEALING_KEY, 'session');
  return sessionSealer;
}

export function transactions(): Sealer {
  transactionSealer ??= createSealer(config().SESSION_SEALING_KEY, 'signin-transaction');
  return transactionSealer;
}
