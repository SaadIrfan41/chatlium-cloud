/**
 * Tenant isolation tests (build guide Step 1.8). Written before the features that rely on them.
 *
 * Data is seeded through chatlium_owner, which is itself subject to RLS because of FORCE. Every
 * assertion runs as chatlium_app, the role the application uses.
 *
 * To prove each test fails for the right reason, `pnpm --filter @chatlium/db test:isolation-proof`
 * re-runs this file with one policy weakened at a time (ISOLATION_WEAKEN_SQL) or with the
 * superuser in place of the app role (ISOLATION_CONNECT_AS_SUPERUSER). See build log 1.8.
 */
import { eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  schema,
  withUser,
  withWorkspace,
  type Database,
  type TenantTransaction,
} from '../../src/index.ts';
import { startMigratedDatabase, type MigratedDatabase } from './fixture.ts';

let fixture: MigratedDatabase;
let app: Database;

const ids = {
  workspaceA: '',
  workspaceB: '',
  userA: '',
  userB: '',
};

/** Seeds as chatlium_owner, setting a system context (workspace, no user) for tenant rows. */
async function seed(ownerUrl: string): Promise<void> {
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const one = async (text: string, values: unknown[] = []): Promise<string> => {
    const result = await owner.query<{ id: string }>(text, values);
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error(`seed returned no id: ${text}`);
    }
    return id;
  };
  try {
    ids.workspaceA = await one("INSERT INTO workspaces (name) VALUES ('A') RETURNING id");
    ids.workspaceB = await one("INSERT INTO workspaces (name) VALUES ('B') RETURNING id");
    ids.userA = await one(
      "INSERT INTO users (cognito_sub, email) VALUES ('sub-a', 'a@example.test') RETURNING id",
    );
    ids.userB = await one(
      "INSERT INTO users (cognito_sub, email) VALUES ('sub-b', 'b@example.test') RETURNING id",
    );
    // One tenant at a time: both use the same connection, and each needs its own transaction.
    await seedTenant(owner, ids.workspaceA, ids.userA, 'a-doc');
    await seedTenant(owner, ids.workspaceB, ids.userB, 'b-doc');
  } finally {
    await owner.end();
  }
}

/** A member, a document and a conversation in one workspace, inside its system context. */
async function seedTenant(
  owner: Client,
  workspaceId: string,
  userId: string,
  title: string,
): Promise<void> {
  await owner.query('BEGIN');
  await owner.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
  await owner.query(
    "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'operator')",
    [workspaceId, userId],
  );
  await owner.query(
    `INSERT INTO documents (workspace_id, title, s3_key, content_type, size_bytes)
     VALUES ($1, $2, 'k/' || gen_random_uuid(), 'text/plain', 1)`,
    [workspaceId, title],
  );
  await owner.query('INSERT INTO conversations (workspace_id) VALUES ($1)', [workspaceId]);
  await owner.query('COMMIT');
}

/**
 * The text of a rejection and its causes. Drizzle wraps the PostgreSQL error as `cause`, so the
 * row-level security message is one level down.
 */
async function rejectionText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    }
    return parts.join(' <- ');
  }
  return 'did not reject';
}

const RLS_VIOLATION = /new row violates row-level security policy for table "documents"/;

beforeAll(async () => {
  fixture = await startMigratedDatabase();
  const weaken = process.env['ISOLATION_WEAKEN_SQL'];
  if (weaken !== undefined && weaken !== '') {
    await fixture.admin.query(weaken);
  }
  await seed(fixture.ownerUrl);
  const asSuperuser = process.env['ISOLATION_CONNECT_AS_SUPERUSER'] === '1';
  app = createDatabase(asSuperuser ? fixture.container.getConnectionUri() : fixture.appUrl);
});

afterAll(async () => {
  await app.close();
  await fixture.stop();
});

const documentWorkspaces = async (tx: TenantTransaction): Promise<string[]> =>
  (await tx.select({ id: schema.documents.workspaceId }).from(schema.documents)).map((r) => r.id);

const conversationWorkspaces = async (tx: TenantTransaction): Promise<string[]> =>
  (await tx.select({ id: schema.conversations.workspaceId }).from(schema.conversations)).map(
    (r) => r.id,
  );

describe('tenant isolation', () => {
  it("1. workspace A's user cannot read workspace B's documents", async () => {
    const asMember = await withWorkspace(
      app.db,
      { workspaceId: ids.workspaceA, userId: ids.userA },
      documentWorkspaces,
    );
    const asWorker = await withWorkspace(
      app.db,
      { workspaceId: ids.workspaceA },
      documentWorkspaces,
    );

    expect(asMember).toEqual([ids.workspaceA]);
    expect(asWorker).toEqual([ids.workspaceA]);
  });

  it("2. workspace A's user cannot read workspace B's conversations", async () => {
    const seen = await withWorkspace(
      app.db,
      { workspaceId: ids.workspaceA, userId: ids.userA },
      conversationWorkspaces,
    );

    expect(seen).toEqual([ids.workspaceA]);
  });

  it("3. inserting a document with workspace B's ID in workspace A's context is refused", async () => {
    const insert = withWorkspace(app.db, { workspaceId: ids.workspaceA, userId: ids.userA }, (tx) =>
      tx.insert(schema.documents).values({
        workspaceId: ids.workspaceB,
        title: 'smuggled',
        s3Key: 'k-smuggled',
        contentType: 'text/plain',
        sizeBytes: 1,
      }),
    );

    expect(await rejectionText(insert)).toMatch(RLS_VIOLATION);
    const smuggled = await fixture.admin.query("SELECT 1 FROM documents WHERE title = 'smuggled'");
    expect(smuggled.rowCount).toBe(0);
  });

  it('4. a transaction with no workspace context reads zero rows from tenant tables', async () => {
    const counts = await app.db.transaction(async (tx) => ({
      documents: (await tx.select().from(schema.documents)).length,
      conversations: (await tx.select().from(schema.conversations)).length,
      memberships: (await tx.select().from(schema.memberships)).length,
    }));

    expect(counts).toEqual({ documents: 0, conversations: 0, memberships: 0 });
  });

  it("5. a user cannot read another user's membership rows through withUser", async () => {
    const rows = await withUser(app.db, ids.userA, (tx) =>
      tx.select({ userId: schema.memberships.userId }).from(schema.memberships),
    );

    expect(rows).toEqual([{ userId: ids.userA }]);
  });

  it('6. a member of A only reads zero rows from B through withWorkspace(B)', async () => {
    const seen = await withWorkspace(
      app.db,
      { workspaceId: ids.workspaceB, userId: ids.userA },
      async (tx) => ({
        documents: await documentWorkspaces(tx),
        conversations: await conversationWorkspaces(tx),
        membershipsOfB: (
          await tx
            .select()
            .from(schema.memberships)
            .where(eq(schema.memberships.workspaceId, ids.workspaceB))
        ).length,
      }),
    );

    expect(seen).toEqual({ documents: [], conversations: [], membershipsOfB: 0 });

    // Writing into B is refused as well.
    const intrude = withWorkspace(
      app.db,
      { workspaceId: ids.workspaceB, userId: ids.userA },
      (tx) =>
        tx.insert(schema.documents).values({
          workspaceId: ids.workspaceB,
          title: 'intruder',
          s3Key: 'k-intruder',
          contentType: 'text/plain',
          sizeBytes: 1,
        }),
    );
    expect(await rejectionText(intrude)).toMatch(RLS_VIOLATION);
  });

  it('7. the application role is not a superuser and does not bypass RLS', async () => {
    const result = await app.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );

    expect(result.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });
});
