/**
 * Creates or updates chatlium_owner and chatlium_app. Run once per database, as an administrator:
 *   pnpm --filter @chatlium/db db:bootstrap
 */
import { Client } from 'pg';
import { bootstrapRoles } from '../src/roles.ts';
import { databaseName, loadScriptEnv } from './env.ts';

const env = loadScriptEnv();
const admin = new Client({ connectionString: env.DATABASE_ADMIN_URL });
await admin.connect();
try {
  await bootstrapRoles(admin, {
    database: databaseName(env.DATABASE_ADMIN_URL),
    ownerPassword: env.CHATLIUM_OWNER_PASSWORD,
    appPassword: env.CHATLIUM_APP_PASSWORD,
  });
  process.stdout.write('Roles chatlium_owner and chatlium_app are bootstrapped.\n');
} finally {
  await admin.end();
}
