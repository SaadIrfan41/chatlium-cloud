import 'server-only';
import { createDatabase, type Database } from '@chatlium/db';
import { config } from './config.ts';

let database: Database | undefined;

/** The application's connection pool, as chatlium_app (never the owner or a superuser). */
export function db(): Database['db'] {
  database ??= createDatabase(config().DATABASE_URL);
  return database.db;
}
