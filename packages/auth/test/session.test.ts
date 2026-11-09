import { createSealer } from '@chatlium/crypto';
import { describe, expect, it } from 'vitest';
import {
  createSessionStore,
  InvalidIdTokenError,
  refreshIfStale,
  UnauthenticatedError,
  type Session,
  type VerifyIdToken,
} from '../src/index.ts';

const SECRET = 'test-only-sealing-secret-0123456789abcdef';
const NOW = new Date('2026-11-09T12:00:00Z');
const nowSeconds = Math.floor(NOW.getTime() / 1000);

const session: Session = {
  userId: '0195d6a4-0000-7000-8000-000000000001',
  cognitoSub: 'cognito-sub-a',
  email: 'operator.a@chatlium.test',
  csrf: 'csrf-token-0123456789abcdef',
  idTokenExpiresAt: nowSeconds + 600,
  refreshToken: 'refresh-token-1',
};

const store = createSessionStore({
  sealer: createSealer(SECRET, 'session', () => NOW),
  cookieName: 'chatlium_session',
  ttlSeconds: 3600,
});

function requestWithCookie(cookie: string | undefined): Request {
  return new Request('http://localhost:3000/api/x', {
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe('requireSession', () => {
  it('returns the caller for a valid sealed session cookie', async () => {
    const sealed = await store.seal(session);

    const user = await store.requireSession(
      requestWithCookie(`theme=dark; chatlium_session=${sealed}; other=1`),
    );

    expect(user).toEqual({
      userId: session.userId,
      cognitoSub: session.cognitoSub,
      email: session.email,
      csrf: session.csrf,
    });
  });

  it('rejects a request without the cookie', async () => {
    await expect(store.requireSession(requestWithCookie('theme=dark'))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(store.requireSession(requestWithCookie(undefined))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('rejects a tampered cookie', async () => {
    const sealed = await store.seal(session);
    const tampered = `${sealed.slice(0, -4)}AAAA`;

    await expect(
      store.requireSession(requestWithCookie(`chatlium_session=${tampered}`)),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a cookie sealed with another secret', async () => {
    const foreign = createSessionStore({
      sealer: createSealer(`${SECRET}-other`, 'session', () => NOW),
      cookieName: 'chatlium_session',
      ttlSeconds: 3600,
    });

    await expect(
      store.requireSession(requestWithCookie(`chatlium_session=${await foreign.seal(session)}`)),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('refuses to seal a session without an application user ID', async () => {
    await expect(store.seal({ ...session, userId: 'not-a-uuid' })).rejects.toThrow(/userId/);
  });
});

const verifyIdToken: VerifyIdToken = async (token) => {
  if (token !== 'new-id-token') {
    throw new InvalidIdTokenError('bad');
  }
  return { sub: 'cognito-sub-a', email: 'renamed@chatlium.test', exp: nowSeconds + 900 };
};
const refresh = async (refreshToken: string) => {
  if (refreshToken !== 'refresh-token-1') {
    throw new Error('invalid_grant');
  }
  return { idToken: 'new-id-token', refreshToken: 'refresh-token-2' };
};

describe('refreshIfStale', () => {
  it('leaves a session alone while its ID token is still valid', async () => {
    let called = false;
    const outcome = await refreshIfStale(session, {
      now: () => NOW,
      verifyIdToken,
      refresh: async (token) => {
        called = true;
        return refresh(token);
      },
    });

    expect(outcome).toEqual({ status: 'fresh', session });
    expect(called).toBe(false);
  });

  it('refreshes an expired session and verifies the new ID token', async () => {
    const stale = { ...session, idTokenExpiresAt: nowSeconds - 1 };

    const outcome = await refreshIfStale(stale, { now: () => NOW, verifyIdToken, refresh });

    expect(outcome).toEqual({
      status: 'refreshed',
      session: {
        ...stale,
        email: 'renamed@chatlium.test',
        idTokenExpiresAt: nowSeconds + 900,
        refreshToken: 'refresh-token-2',
      },
    });
  });

  it('refreshes slightly before expiry, not after', async () => {
    const almost = { ...session, idTokenExpiresAt: nowSeconds + 10 };

    const outcome = await refreshIfStale(almost, { now: () => NOW, verifyIdToken, refresh });

    expect(outcome.status).toBe('refreshed');
  });

  it('ends the session when Cognito refuses the refresh token (revoked or disabled user)', async () => {
    const outcome = await refreshIfStale(
      { ...session, idTokenExpiresAt: nowSeconds - 1, refreshToken: 'revoked' },
      { now: () => NOW, verifyIdToken, refresh },
    );

    expect(outcome).toEqual({ status: 'ended' });
  });

  it('ends the session when the new ID token fails verification', async () => {
    const outcome = await refreshIfStale(
      { ...session, idTokenExpiresAt: nowSeconds - 1 },
      { now: () => NOW, verifyIdToken, refresh: async () => ({ idToken: 'forged' }) },
    );

    expect(outcome).toEqual({ status: 'ended' });
  });

  it('ends the session when the new ID token belongs to another user', async () => {
    const outcome = await refreshIfStale(
      { ...session, idTokenExpiresAt: nowSeconds - 1 },
      {
        now: () => NOW,
        refresh,
        verifyIdToken: async () => ({
          sub: 'someone-else',
          email: 'x@y.test',
          exp: nowSeconds + 900,
        }),
      },
    );

    expect(outcome).toEqual({ status: 'ended' });
  });

  it('ends an expired session that has no refresh token', async () => {
    const { refreshToken: _omitted, ...withoutRefresh } = session;

    const outcome = await refreshIfStale(
      { ...withoutRefresh, idTokenExpiresAt: nowSeconds - 1 },
      { now: () => NOW, verifyIdToken, refresh },
    );

    expect(outcome).toEqual({ status: 'ended' });
  });
});
