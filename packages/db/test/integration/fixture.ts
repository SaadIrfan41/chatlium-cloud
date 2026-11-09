import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { APP_ROLE, bootstrapRoles, OWNER_ROLE, runMigrations } from '../../src/index.ts';
import { connect, startPostgres, urlFor } from './postgres.ts';

export const OWNER_PASSWORD = 'owner-test-password-0123456789abcdef';
export const APP_PASSWORD = 'app-test-password-0123456789abcdef';

/** A fresh, fully migrated database: the same setup every environment goes through. */
export interface MigratedDatabase {
  readonly container: StartedPostgreSqlContainer;
  /** Superuser connection. Bypasses RLS: use it only to seed and inspect. */
  readonly admin: Client;
  readonly ownerUrl: string;
  readonly appUrl: string;
  stop(): Promise<void>;
}

export async function startMigratedDatabase(): Promise<MigratedDatabase> {
  const container = await startPostgres();
  const admin = await connect(container.getConnectionUri());
  await bootstrapRoles(admin, {
    database: container.getDatabase(),
    ownerPassword: OWNER_PASSWORD,
    appPassword: APP_PASSWORD,
  });
  const ownerUrl = urlFor(container, OWNER_ROLE, OWNER_PASSWORD);
  await runMigrations(ownerUrl);
  return {
    container,
    admin,
    ownerUrl,
    appUrl: urlFor(container, APP_ROLE, APP_PASSWORD),
    stop: async () => {
      await admin.end();
      await container.stop();
    },
  };
}

/** Inserts a workspace as the superuser and returns its ID. */
export async function seedWorkspace(admin: Client, name: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error('workspace insert returned no id');
  }
  return id;
}

export async function seedDocument(
  admin: Client,
  workspaceId: string,
  title: string,
): Promise<void> {
  await admin.query(
    "INSERT INTO documents (workspace_id, title, s3_key) VALUES ($1, $2, 'test-key')",
    [workspaceId, title],
  );
}
