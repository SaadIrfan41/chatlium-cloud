import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_ROLE,
  bootstrapRoles,
  MIGRATIONS_SCHEMA,
  OWNER_ROLE,
  runMigrations,
} from '../../src/admin.ts';
import { connect, startPostgres, urlFor } from './postgres.ts';

const OWNER_PASSWORD = 'owner-test-password-0123456789abcdef';
const APP_PASSWORD = 'app-test-password-0123456789abcdef';
const TENANT_TABLES = ['conversations', 'documents', 'memberships'];
const GLOBAL_TABLES = ['users', 'workspaces'];

let container: StartedPostgreSqlContainer;
let admin: Client;
let ownerUrl: string;

beforeAll(async () => {
  container = await startPostgres();
  admin = await connect(container.getConnectionUri());
  await bootstrapRoles(admin, {
    database: container.getDatabase(),
    ownerPassword: OWNER_PASSWORD,
    appPassword: APP_PASSWORD,
  });
  ownerUrl = urlFor(container, OWNER_ROLE, OWNER_PASSWORD);
  await runMigrations(ownerUrl);
});

afterAll(async () => {
  await admin.end();
  await container.stop();
});

async function as<T>(
  user: string,
  password: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect(urlFor(container, user, password));
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function appliedMigrationCount(): Promise<string | undefined> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${MIGRATIONS_SCHEMA}.__drizzle_migrations`,
  );
  return result.rows[0]?.n;
}

interface TableSecurity {
  relname: string;
  enabled: boolean;
  forced: boolean;
  owner: string;
}

async function tableSecurity(): Promise<TableSecurity[]> {
  const result = await admin.query<TableSecurity>(
    `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced,
            pg_get_userbyid(relowner) AS owner
       FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
      ORDER BY relname`,
  );
  return result.rows;
}

describe('migrations', () => {
  it('create the five Phase 1 tables, all owned by chatlium_owner', async () => {
    const tables = await tableSecurity();

    expect(tables.map((t) => t.relname)).toEqual([...TENANT_TABLES, ...GLOBAL_TABLES].toSorted());
    expect(new Set(tables.map((t) => t.owner))).toEqual(new Set([OWNER_ROLE]));
  });

  it('enable and force row-level security on every tenant table', async () => {
    const tables = await tableSecurity();

    for (const name of TENANT_TABLES) {
      expect(tables.find((t) => t.relname === name)).toMatchObject({ enabled: true, forced: true });
    }
    for (const name of GLOBAL_TABLES) {
      expect(tables.find((t) => t.relname === name)).toMatchObject({ enabled: false });
    }
  });

  it('create the tenant and membership policies', async () => {
    const result = await admin.query<{ tablename: string; policyname: string; cmd: string }>(
      'SELECT tablename, policyname, cmd FROM pg_policies ORDER BY tablename, policyname',
    );

    expect(result.rows).toEqual([
      { tablename: 'conversations', policyname: 'tenant_isolation', cmd: 'ALL' },
      { tablename: 'documents', policyname: 'tenant_isolation', cmd: 'ALL' },
      { tablename: 'memberships', policyname: 'membership_write', cmd: 'ALL' },
      { tablename: 'memberships', policyname: 'own_memberships', cmd: 'SELECT' },
    ]);
  });

  it('are a no-op when run a second time', async () => {
    const before = await appliedMigrationCount();

    await runMigrations(ownerUrl);

    expect(before).toBe('3');
    expect(await appliedMigrationCount()).toBe(before);
  });

  it('apply RLS to the table owner too, because of FORCE', async () => {
    const workspace = await admin.query<{ id: string }>(
      "INSERT INTO workspaces (name) VALUES ('force-check') RETURNING id",
    );
    const workspaceId = workspace.rows[0]?.id;
    await admin.query(
      "INSERT INTO documents (workspace_id, title, s3_key) VALUES ($1, 'doc', 'k')",
      [workspaceId],
    );

    // The superuser bypasses RLS and sees the row; the owner, with no workspace context, must not.
    const asAdmin = await admin.query('SELECT 1 FROM documents');
    const asOwner = await as(OWNER_ROLE, OWNER_PASSWORD, (client) =>
      client.query('SELECT 1 FROM documents'),
    );

    expect(asAdmin.rowCount).toBe(1);
    expect(asOwner.rowCount).toBe(0);
  });

  it('fail closed, without an error, when the workspace setting is an empty string', async () => {
    // After a transaction-local set_config, a pooled session reads the setting back as ''.
    const rows = await as(APP_ROLE, APP_PASSWORD, async (client) => {
      await client.query("SELECT set_config('app.workspace_id', '', false)");
      await client.query("SELECT set_config('app.user_id', '', false)");
      const documents = await client.query('SELECT 1 FROM documents');
      const conversations = await client.query('SELECT 1 FROM conversations');
      const memberships = await client.query('SELECT 1 FROM memberships');
      return [documents.rowCount, conversations.rowCount, memberships.rowCount];
    });

    expect(rows).toEqual([0, 0, 0]);
  });

  it('give the application role DML on the new tables through default privileges', async () => {
    const result = await admin.query<{ table_name: string; privileges: string }>(
      `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
         FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'public'
        GROUP BY table_name ORDER BY table_name`,
      [APP_ROLE],
    );

    expect(result.rows).toHaveLength(5);
    for (const row of result.rows) {
      expect(row.privileges).toBe('DELETE,INSERT,SELECT,UPDATE');
    }
  });

  it('keep the migration history out of reach of the application role', async () => {
    await expect(
      as(APP_ROLE, APP_PASSWORD, (client) =>
        client.query(`SELECT * FROM ${MIGRATIONS_SCHEMA}.__drizzle_migrations`),
      ),
    ).rejects.toThrow(/permission denied for schema drizzle/);
  });
});
