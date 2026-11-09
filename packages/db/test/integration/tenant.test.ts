import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  InvalidTenantIdError,
  schema,
  withUser,
  withWorkspace,
  type Database,
  type TenantTransaction,
} from '../../src/index.ts';
import {
  seedDocument,
  seedWorkspace,
  startMigratedDatabase,
  type MigratedDatabase,
} from './fixture.ts';

let fixture: MigratedDatabase;
/** One connection only, so every transaction below runs on the same physical connection. */
let single: Database;
let workspaceA: string;
let workspaceB: string;

beforeAll(async () => {
  fixture = await startMigratedDatabase();
  single = createDatabase(fixture.appUrl, { max: 1 });
  workspaceA = await seedWorkspace(fixture.admin, 'A');
  workspaceB = await seedWorkspace(fixture.admin, 'B');
  await seedDocument(fixture.admin, workspaceA, 'a-doc');
  await seedDocument(fixture.admin, workspaceB, 'b-doc');
});

afterAll(async () => {
  await single.close();
  await fixture.stop();
});

interface SessionState {
  pid: number;
  workspace: string | null;
  user: string | null;
}

/** Reads the backend process ID and both context settings, outside any helper. */
async function sessionState(db: Database): Promise<SessionState> {
  const result = await db.pool.query<SessionState>(
    `SELECT pg_backend_pid() AS pid,
            nullif(current_setting('app.workspace_id', true), '') AS workspace,
            nullif(current_setting('app.user_id', true), '') AS "user"`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('no session state row');
  }
  return row;
}

async function settingsInside(tx: TenantTransaction): Promise<Omit<SessionState, 'pid'>> {
  const result = await tx.execute<{ workspace: string | null; user: string | null }>(
    sql`SELECT nullif(current_setting('app.workspace_id', true), '') AS workspace,
               nullif(current_setting('app.user_id', true), '') AS "user"`,
  );
  return { workspace: result.rows[0]?.workspace ?? null, user: result.rows[0]?.user ?? null };
}

describe('withWorkspace', () => {
  it('sets the workspace context inside the transaction only', async () => {
    const inside = await withWorkspace(single.db, { workspaceId: workspaceA }, settingsInside);

    expect(inside).toEqual({ workspace: workspaceA, user: null });
  });

  it('leaves no workspace context on the same connection once it completes', async () => {
    const before = await sessionState(single);
    await withWorkspace(single.db, { workspaceId: workspaceA }, async () => undefined);

    const after = await sessionState(single);

    expect(after.pid).toBe(before.pid); // the very same connection
    expect(after.workspace).toBeNull();
  });

  it('leaves no context behind when the callback throws, and rolls back its writes', async () => {
    const failure = new Error('boom');

    await expect(
      withWorkspace(single.db, { workspaceId: workspaceA }, async (tx) => {
        await tx
          .insert(schema.documents)
          .values({ workspaceId: workspaceA, title: 'rolled-back', s3Key: 'k' });
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect((await sessionState(single)).workspace).toBeNull();
    const rows = await fixture.admin.query("SELECT 1 FROM documents WHERE title = 'rolled-back'");
    expect(rows.rowCount).toBe(0);
  });

  it('scopes queries to the workspace through row-level security', async () => {
    const titles = await withWorkspace(single.db, { workspaceId: workspaceB }, async (tx) =>
      (await tx.select({ title: schema.documents.title }).from(schema.documents)).map(
        (d) => d.title,
      ),
    );

    expect(titles).toEqual(['b-doc']);
  });

  it('keeps concurrent transactions on different connections in their own workspace', async () => {
    const pooled = createDatabase(fixture.appUrl, { max: 2 });
    try {
      const read = (workspaceId: string) =>
        withWorkspace(pooled.db, { workspaceId }, async (tx) => {
          await tx.execute(sql`SELECT pg_sleep(0.2)`); // overlap the two transactions
          return (await tx.select({ title: schema.documents.title }).from(schema.documents)).map(
            (d) => d.title,
          );
        });

      const [a, b] = await Promise.all([read(workspaceA), read(workspaceB)]);

      expect(a).toEqual(['a-doc']);
      expect(b).toEqual(['b-doc']);
    } finally {
      await pooled.close();
    }
  });

  it('rejects a workspace ID that is not a UUID before running any SQL', async () => {
    const injection = "00000000-0000-0000-0000-000000000000'; DROP TABLE documents; --";
    let called = false;

    await expect(
      withWorkspace(single.db, { workspaceId: injection }, async () => {
        called = true;
      }),
    ).rejects.toBeInstanceOf(InvalidTenantIdError);

    expect(called).toBe(false);
    expect((await fixture.admin.query('SELECT 1 FROM documents')).rowCount).toBe(2);
  });
});

describe('withUser', () => {
  it('sets only the user context, and clears it afterwards on the same connection', async () => {
    const userId = '0195d6a4-0000-7000-8000-000000000001';

    const inside = await withUser(single.db, userId, settingsInside);
    const after = await sessionState(single);

    expect(inside).toEqual({ workspace: null, user: userId });
    expect(after.user).toBeNull();
  });

  it('rejects a user ID that is not a UUID', async () => {
    await expect(withUser(single.db, 'not-a-uuid', async () => undefined)).rejects.toBeInstanceOf(
      InvalidTenantIdError,
    );
  });
});
