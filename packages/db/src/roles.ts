import type { ClientBase } from 'pg';

/** Owns the schema and runs migrations. Never used by the application. */
export const OWNER_ROLE = 'chatlium_owner';
/** Used by the application. Not a superuser and cannot bypass row-level security. */
export const APP_ROLE = 'chatlium_app';

export interface BootstrapOptions {
  /** Database the roles are granted access to. */
  readonly database: string;
  readonly ownerPassword: string;
  readonly appPassword: string;
}

/**
 * Creates or updates the two database roles and their privileges. Idempotent.
 *
 * Must run as an administrator (the local superuser, or the RDS master user), because creating
 * roles needs CREATEROLE. Migrations then run as chatlium_owner, which cannot create roles.
 *
 * Statements with identifiers or passwords are built server-side with format() and bind
 * parameters, so no value is ever concatenated into SQL.
 */
export async function bootstrapRoles(admin: ClientBase, options: BootstrapOptions): Promise<void> {
  await admin.query('BEGIN');
  try {
    await upsertRole(admin, OWNER_ROLE, options.ownerPassword, ['NOINHERIT']);
    await upsertRole(admin, APP_ROLE, options.appPassword, ['NOINHERIT', 'NOBYPASSRLS']);

    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Only the two roles may connect. Nobody else gets default CONNECT or TEMP.
    await execFormatted(admin, 'REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', [
      options.database,
    ]);
    await execFormatted(admin, 'GRANT CONNECT ON DATABASE %I TO %I, %I', [
      options.database,
      OWNER_ROLE,
      APP_ROLE,
    ]);

    // The owner owns the schema, so tables it creates in migrations are owned by it.
    await execFormatted(admin, 'ALTER SCHEMA public OWNER TO %I', [OWNER_ROLE]);
    await admin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await execFormatted(admin, 'GRANT USAGE ON SCHEMA public TO %I', [APP_ROLE]);

    // Tables and sequences the owner creates later are usable by the app, with DML only:
    // no TRUNCATE, REFERENCES, TRIGGER or DDL.
    await execFormatted(
      admin,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      [OWNER_ROLE, APP_ROLE],
    );
    await execFormatted(
      admin,
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
      [OWNER_ROLE, APP_ROLE],
    );

    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

async function upsertRole(
  admin: ClientBase,
  role: string,
  password: string,
  extraAttributes: readonly string[],
): Promise<void> {
  const attributes = [
    'LOGIN',
    'NOSUPERUSER',
    'NOCREATEDB',
    'NOCREATEROLE',
    'NOREPLICATION',
    ...extraAttributes,
  ].join(' ');
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const verb = exists.rowCount === 0 ? 'CREATE' : 'ALTER';
  await execFormatted(admin, `${verb} ROLE %I WITH ${attributes} PASSWORD %L`, [role, password]);
}

/** Builds a statement with format() on the server, then runs it. */
async function execFormatted(
  admin: ClientBase,
  template: string,
  values: readonly string[],
): Promise<void> {
  const placeholders = values.map((_, index) => `$${index + 2}::text`).join(', ');
  const built = await admin.query<{ sql: string }>(`SELECT format($1, ${placeholders}) AS sql`, [
    template,
    ...values,
  ]);
  const sql = built.rows[0]?.sql;
  if (sql === undefined) {
    throw new Error('format() returned no statement');
  }
  await admin.query(sql);
}

export interface RoleFlags {
  readonly rolname: string;
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
}

/** Reads the safety-relevant attributes of a role. */
export async function readRoleFlags(
  client: ClientBase,
  role: string,
): Promise<RoleFlags | undefined> {
  const result = await client.query<RoleFlags>(
    'SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1',
    [role],
  );
  return result.rows[0];
}
