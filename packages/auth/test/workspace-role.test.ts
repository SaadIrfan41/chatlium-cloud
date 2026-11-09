import { createSealer } from '@chatlium/crypto';
import { describe, expect, it } from 'vitest';
import {
  createSessionStore,
  createWorkspaceGuard,
  ForbiddenError,
  roleAtLeast,
  UnauthenticatedError,
  type WorkspaceRole,
} from '../src/index.ts';

const USER_ID = '0195d6a4-0000-7000-8000-000000000001';
const WORKSPACE_A = '0195d6a4-0000-7000-8000-00000000000a';
const WORKSPACE_B = '0195d6a4-0000-7000-8000-00000000000b';

const store = createSessionStore({
  sealer: createSealer('test-only-sealing-secret-0123456789abcdef', 'session'),
  cookieName: 'chatlium_session',
  ttlSeconds: 3600,
});

/** User 1 is an operator in workspace A and nothing else. */
const lookups: [string, string][] = [];
const guard = createWorkspaceGuard({
  sessions: store,
  lookupRole: (userId, workspaceId) => {
    lookups.push([userId, workspaceId]);
    return Promise.resolve(
      userId === USER_ID && workspaceId === WORKSPACE_A ? ('operator' as const) : undefined,
    );
  },
});

async function signedInRequest(): Promise<Request> {
  const sealed = await store.seal({
    userId: USER_ID,
    cognitoSub: 'cognito-sub-a',
    email: 'operator.a@chatlium.test',
    csrf: 'csrf-token-0123456789abcdef',
    idTokenExpiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  return new Request('http://localhost:3000/api/x', {
    headers: { cookie: `chatlium_session=${sealed}` },
  });
}

describe('roleAtLeast', () => {
  const cases: [WorkspaceRole, WorkspaceRole, boolean][] = [
    ['operator', 'operator', true],
    ['admin', 'operator', true],
    ['owner', 'operator', true],
    ['operator', 'admin', false],
    ['admin', 'admin', true],
    ['owner', 'admin', true],
    ['operator', 'owner', false],
    ['admin', 'owner', false],
    ['owner', 'owner', true],
  ];
  it.each(cases)('%s meets minimum %s: %s', (role, minimum, expected) => {
    expect(roleAtLeast(role, minimum)).toBe(expected);
  });
});

describe('requireWorkspaceRole', () => {
  it('returns the membership when the role meets the minimum', async () => {
    const member = await guard.requireWorkspaceRole(
      await signedInRequest(),
      WORKSPACE_A,
      'operator',
    );

    expect(member).toMatchObject({
      user: { userId: USER_ID },
      workspaceId: WORKSPACE_A,
      role: 'operator',
    });
  });

  it('rejects a caller without a session before any membership lookup', async () => {
    lookups.length = 0;

    await expect(
      guard.requireWorkspaceRole(new Request('http://localhost:3000/'), WORKSPACE_A, 'operator'),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(lookups).toEqual([]);
  });

  it('rejects a role below the minimum', async () => {
    await expect(
      guard.requireWorkspaceRole(await signedInRequest(), WORKSPACE_A, 'admin'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a workspace the user is not a member of', async () => {
    await expect(
      guard.requireWorkspaceRole(await signedInRequest(), WORKSPACE_B, 'operator'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a malformed workspace ID the same way, without a lookup', async () => {
    lookups.length = 0;

    const error = await guard
      .requireWorkspaceRole(await signedInRequest(), "a' OR '1'='1", 'operator')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toHaveProperty('message', 'Forbidden');
    expect(lookups).toEqual([]);
  });

  it('looks up the membership of the session user, not anyone else', async () => {
    lookups.length = 0;

    await guard.requireWorkspaceRole(await signedInRequest(), WORKSPACE_A, 'operator');
    expect(lookups).toEqual([[USER_ID, WORKSPACE_A]]);
  });
});
