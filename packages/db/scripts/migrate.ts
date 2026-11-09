/**
 * Applies pending migrations as chatlium_owner:
 *   pnpm --filter @chatlium/db db:migrate
 */
import { runMigrations } from '../src/migrate.ts';
import { loadScriptEnv } from './env.ts';

const env = loadScriptEnv();
await runMigrations(env.DATABASE_OWNER_URL);
process.stdout.write('Migrations are up to date.\n');
