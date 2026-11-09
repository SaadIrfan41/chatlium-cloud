import { createSessionStore, createWorkspaceGuard } from '@chatlium/auth';
import { createSealer } from '@chatlium/crypto';
import { createDatabase, findMembershipRole, type Database } from '@chatlium/db';
import {
  seedDocument,
  seedMembership,
  seedUser,
  seedWorkspace,
  startMigratedDatabase,
  type MigratedDatabase,
} from '@chatlium/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createWorkspaceApi, type WorkspaceApi } from '../../src/server/api/workspaces.ts';

// Build guide 1.12: the workspace API against a real, migrated database, connected as
// chatlium_app (RLS enforced), with sessions sealed exactly as the sign-in callback seals them.

const sessions = createSessionStore({
  sealer: createSealer('integration-test-sealing-secret-0123456789', 'session'),
  cookieName: 'chatlium_session',
  ttlSeconds: 3600,
});

let fixture: MigratedDatabase;
let app: Database;
let api: WorkspaceApi;
let workspaceA: string;
let workspaceB: string;
let operatorA: string;
let adminB: string;
let outsider: string;

beforeAll(async () => {
  fixture = await startMigratedDatabase();
  app = createDatabase(fixture.appUrl);
  api = createWorkspaceApi({
    sessions,
    guard: createWorkspaceGuard({
      sessions,
      lookupRole: (userId, workspaceId) => findMembershipRole(app.db, userId, workspaceId),
    }),
    db: app.db,
  });

  workspaceA = await seedWorkspace(fixture.admin, 'Acme Support');
  workspaceB = await seedWorkspace(fixture.admin, 'Beta Help Desk');
  operatorA = await seedUser(fixture.admin, 'sub-operator-a', 'operator.a@chatlium.test');
  adminB = await seedUser(fixture.admin, 'sub-admin-b', 'admin.b@chatlium.test');
  outsider = await seedUser(fixture.admin, 'sub-outsider', 'outsider@chatlium.test');
  await seedMembership(fixture.admin, workspaceA, operatorA, 'operator');
  await seedMembership(fixture.admin, workspaceB, adminB, 'admin');
  await seedDocument(fixture.admin, workspaceA, 'A: refund policy');
  await seedDocument(fixture.admin, workspaceB, 'B: shipping times');
});

afterAll(async () => {
  await app.close();
  await fixture.stop();
});

async function requestAs(userId: string, path = '/api/x'): Promise<Request> {
  const sealed = await sessions.seal({
    userId,
    cognitoSub: `sub-for-${userId}`,
    email: 'someone@chatlium.test',
    csrf: 'csrf-token-0123456789abcdef',
    idTokenExpiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  return new Request(`http://localhost:3000${path}`, {
    headers: { cookie: `chatlium_session=${sealed}` },
  });
}

const documentsBody = z.object({ documents: z.array(z.object({ title: z.string() })) });

/** Everything a client can observe about a response. */
async function observe(response: Response) {
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  };
}

describe('GET /api/workspaces/:id/documents', () => {
  it('a member with the operator role gets 200 and only that workspace’s documents', async () => {
    const response = await api.listDocuments(await requestAs(operatorA), workspaceA);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = documentsBody.parse(await response.json());
    expect(body.documents.map((document) => document.title)).toEqual(['A: refund policy']);
  });

  it('a role above the minimum also gets 200', async () => {
    const response = await api.listDocuments(await requestAs(adminB), workspaceB);

    expect(response.status).toBe(200);
    const body = documentsBody.parse(await response.json());
    expect(body.documents.map((document) => document.title)).toEqual(['B: shipping times']);
  });

  it('a non-member gets 403, identical to the response for a workspace that does not exist', async () => {
    const notAMember = await observe(
      await api.listDocuments(await requestAs(operatorA), workspaceB),
    );
    const noSuchWorkspace = await observe(
      await api.listDocuments(await requestAs(operatorA), '0195d6a4-ffff-7fff-bfff-ffffffffffff'),
    );
    const notAWorkspaceId = await observe(
      await api.listDocuments(await requestAs(operatorA), 'not-a-uuid'),
    );

    expect(notAMember).toEqual({
      status: 403,
      contentType: 'application/json',
      cacheControl: 'no-store',
      body: '{"error":"forbidden"}',
    });
    expect(noSuchWorkspace).toEqual(notAMember);
    expect(notAWorkspaceId).toEqual(notAMember);
  });

  it('a user with no memberships at all gets the same 403', async () => {
    const response = await observe(await api.listDocuments(await requestAs(outsider), workspaceA));

    expect(response).toMatchObject({ status: 403, body: '{"error":"forbidden"}' });
  });

  it('a member whose role is below the minimum gets 403', async () => {
    // Raise the route's bar instead of adding a role below operator: operator is the lowest role,
    // so "wrong role" is checked against a guard requiring admin, through the same lookup.
    const guard = createWorkspaceGuard({
      sessions,
      lookupRole: (userId, workspaceId) => findMembershipRole(app.db, userId, workspaceId),
    });

    await expect(
      guard.requireWorkspaceRole(await requestAs(operatorA), workspaceA, 'admin'),
    ).rejects.toHaveProperty('name', 'ForbiddenError');
    await expect(
      guard.requireWorkspaceRole(await requestAs(adminB), workspaceB, 'owner'),
    ).rejects.toHaveProperty('name', 'ForbiddenError');
  });

  it('a request without a session gets 401', async () => {
    const response = await api.listDocuments(new Request('http://localhost:3000/'), workspaceA);

    expect(await observe(response)).toMatchObject({
      status: 401,
      body: '{"error":"unauthenticated"}',
    });
  });
});

describe('GET /api/workspaces', () => {
  it('lists only the signed-in user’s workspaces, with their role', async () => {
    const response = await api.listWorkspaces(await requestAs(operatorA));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspaces: [{ id: workspaceA, name: 'Acme Support', role: 'operator' }],
    });
  });

  it('is empty for a user with no memberships', async () => {
    const response = await api.listWorkspaces(await requestAs(outsider));

    expect(await response.json()).toEqual({ workspaces: [] });
  });

  it('a request without a session gets 401', async () => {
    const response = await api.listWorkspaces(new Request('http://localhost:3000/'));

    expect(response.status).toBe(401);
  });
});
