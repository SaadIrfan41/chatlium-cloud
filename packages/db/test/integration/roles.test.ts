import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ROLE, bootstrapRoles, OWNER_ROLE, readRoleFlags } from '../../src/index.ts';
import { connect, startPostgres, urlFor } from './postgres.ts';

const OWNER_PASSWORD = 'owner-test-password-0123456789abcdef';
const APP_PASSWORD = 'app-test-password-0123456789abcdef';

let container: StartedPostgreSqlContainer;
let admin: Client;

beforeAll(async () => {
  container = await startPostgres();
  admin = await connect(container.getConnectionUri());
  const options = {
    database: container.getDatabase(),
    ownerPassword: OWNER_PASSWORD,
    appPassword: APP_PASSWORD,
  };
  await bootstrapRoles(admin, options);
  // Running it twice must be harmless.
  await bootstrapRoles(admin, options);
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

describe('bootstrapRoles', () => {
  it('creates an application role that is not a superuser and does not bypass RLS', async () => {
    const flags = await readRoleFlags(admin, APP_ROLE);

    expect(flags).toEqual({
      rolname: APP_ROLE,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
  });

  it('creates an owner role without superuser, BYPASSRLS, CREATEROLE or CREATEDB', async () => {
    expect(await readRoleFlags(admin, OWNER_ROLE)).toEqual({
      rolname: OWNER_ROLE,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
  });

  it('lets the application role connect', async () => {
    const user = await as(APP_ROLE, APP_PASSWORD, async (client) => {
      const result = await client.query<{ user: string }>('SELECT current_user AS user');
      return result.rows[0]?.user;
    });

    expect(user).toBe(APP_ROLE);
  });

  it('makes pgvector available', async () => {
    const result = await admin.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");

    expect(result.rowCount).toBe(1);
  });

  it('refuses DDL by the application role', async () => {
    await expect(
      as(APP_ROLE, APP_PASSWORD, (client) => client.query('CREATE TABLE app_made (id int)')),
    ).rejects.toThrow(/permission denied for schema public/);
  });

  it('gives the application role DML only on tables the owner creates', async () => {
    await as(OWNER_ROLE, OWNER_PASSWORD, async (client) => {
      await client.query('CREATE TABLE owner_made (id serial PRIMARY KEY, note text)');
    });

    await as(APP_ROLE, APP_PASSWORD, async (client) => {
      await client.query("INSERT INTO owner_made (note) VALUES ('hello')");
      await client.query("UPDATE owner_made SET note = 'updated'");
      const rows = await client.query<{ note: string }>('SELECT note FROM owner_made');
      expect(rows.rows).toEqual([{ note: 'updated' }]);
      await client.query('DELETE FROM owner_made');

      await expect(client.query('TRUNCATE owner_made')).rejects.toThrow(/permission denied/);
      await expect(client.query('DROP TABLE owner_made')).rejects.toThrow(/must be owner/);
    });
  });

  it('resets a drifted application role back to non-superuser without BYPASSRLS', async () => {
    await admin.query(`ALTER ROLE ${APP_ROLE} SUPERUSER BYPASSRLS CREATEROLE`);

    await bootstrapRoles(admin, {
      database: container.getDatabase(),
      ownerPassword: OWNER_PASSWORD,
      appPassword: APP_PASSWORD,
    });

    expect(await readRoleFlags(admin, APP_ROLE)).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
    });
  });

  it('does not let other roles connect to the database', async () => {
    await admin.query("CREATE ROLE outsider LOGIN PASSWORD 'outsider-password'");

    await expect(
      as('outsider', 'outsider-password', (client) => client.query('SELECT 1')),
    ).rejects.toThrow(/permission denied for database/);
  });
});
