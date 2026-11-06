import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export interface Database {
  readonly db: NodePgDatabase;
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * Creates the application's connection pool and Drizzle instance.
 * The URL must be for chatlium_app, never for the owner or a superuser.
 */
export function createDatabase(connectionString: string, options: { max?: number } = {}): Database {
  const pool = new Pool({ connectionString, max: options.max ?? 10 });
  return {
    db: drizzle({ client: pool }),
    pool,
    close: () => pool.end(),
  };
}
