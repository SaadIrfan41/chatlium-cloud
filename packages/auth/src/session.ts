import type { Sealer } from '@chatlium/crypto';
import { z } from 'zod';
import type { VerifyIdToken } from './id-token.ts';

/**
 * What the sealed session cookie holds. No access or ID token is stored. The refresh token never
 * leaves the server: the cookie is encrypted and HttpOnly.
 */
export const sessionSchema = z.object({
  /** The application's user ID (users.id), created on first sign-in. */
  userId: z.uuid(),
  cognitoSub: z.string().min(1),
  email: z.string().min(1),
  /** Synchronizer token for state-changing form posts (amendments §2). */
  csrf: z.string().min(16),
  /** When the last verified ID token expires (seconds since the epoch). */
  idTokenExpiresAt: z.number().int(),
  refreshToken: z.string().min(1).optional(),
});
export type Session = z.infer<typeof sessionSchema>;

/** What a protected route needs to know about the caller. */
export interface SessionUser {
  readonly userId: string;
  readonly cognitoSub: string;
  readonly email: string;
  readonly csrf: string;
}

/** No valid session. Callers answer 401 or redirect to sign-in. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'UnauthenticatedError';
  }
}

export interface SessionStoreOptions {
  readonly sealer: Sealer;
  readonly cookieName: string;
  readonly ttlSeconds: number;
}

/** Reads one cookie from a Cookie header without decoding anything else. */
function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

export function createSessionStore(options: SessionStoreOptions) {
  const unseal = (sealed: string | undefined): Promise<Session | undefined> =>
    sealed === undefined || sealed === ''
      ? Promise.resolve(undefined)
      : options.sealer.unseal(sealed, sessionSchema);

  return {
    cookieName: options.cookieName,
    ttlSeconds: options.ttlSeconds,

    async seal(session: Session): Promise<string> {
      return options.sealer.seal(sessionSchema.parse(session), options.ttlSeconds);
    },

    /** The session in a sealed cookie value, or undefined if missing, tampered or expired. */
    read(sealed: string | undefined): Promise<Session | undefined> {
      return unseal(sealed);
    },

    /**
     * Build guide 1.11: reads the sealed session cookie from the request, verifies it (decryption
     * authenticates it, and expiry is inside the ciphertext), and returns the caller.
     * Throws UnauthenticatedError otherwise.
     */
    async requireSession(request: Request): Promise<SessionUser> {
      const session = await unseal(readCookie(request.headers.get('cookie'), options.cookieName));
      if (session === undefined) {
        throw new UnauthenticatedError();
      }
      return {
        userId: session.userId,
        cognitoSub: session.cognitoSub,
        email: session.email,
        csrf: session.csrf,
      };
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

export interface RefreshDependencies {
  /** Redeems a refresh token at Cognito's token endpoint. Throws if Cognito refuses it. */
  readonly refresh: (refreshToken: string) => Promise<{ idToken: string; refreshToken?: string }>;
  readonly verifyIdToken: VerifyIdToken;
  readonly now?: () => Date;
  /** Refresh this many seconds before expiry, so a request never runs on a just-expired token. */
  readonly skewSeconds?: number;
}

export type RefreshOutcome =
  | { readonly status: 'fresh'; readonly session: Session }
  | { readonly status: 'refreshed'; readonly session: Session }
  | { readonly status: 'ended' };

/**
 * Keeps the session tied to a live Cognito sign-in (decision record §2: short-lived tokens,
 * refreshed on the server). While the last ID token is valid, nothing happens. After that, the
 * refresh token is redeemed and the new ID token verified again. If Cognito refuses (user
 * disabled, global sign-out, token revoked) or the token belongs to someone else, the session
 * ends. This is what makes revocation take effect within one token lifetime.
 */
export async function refreshIfStale(
  session: Session,
  dependencies: RefreshDependencies,
): Promise<RefreshOutcome> {
  const now = Math.floor((dependencies.now?.() ?? new Date()).getTime() / 1000);
  if (session.idTokenExpiresAt - (dependencies.skewSeconds ?? 30) > now) {
    return { status: 'fresh', session };
  }
  if (session.refreshToken === undefined) {
    return { status: 'ended' };
  }
  try {
    const tokens = await dependencies.refresh(session.refreshToken);
    const claims = await dependencies.verifyIdToken(tokens.idToken);
    if (claims.sub !== session.cognitoSub) {
      return { status: 'ended' };
    }
    return {
      status: 'refreshed',
      session: {
        ...session,
        email: claims.email,
        idTokenExpiresAt: claims.exp,
        refreshToken: tokens.refreshToken ?? session.refreshToken,
      },
    };
  } catch {
    return { status: 'ended' };
  }
}
