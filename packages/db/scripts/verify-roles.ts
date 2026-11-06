/**
 * Prints the role check from build guide Step 1.5 and confirms each role can connect.
 *   pnpm --filter @chatlium/db db:verify-roles
 */
import { Client } from 'pg';
import { APP_ROLE, OWNER_ROLE, readRoleFlags } from '../src/roles.ts';
import { loadScriptEnv } from './env.ts';

const env = loadScriptEnv();

async function withClient<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const out = (line: string): void => void process.stdout.write(`${line}\n`);

await withClient(env.DATABASE_ADMIN_URL, async (admin) => {
  const all = await Promise.all(
    [OWNER_ROLE, APP_ROLE].map(async (role) => ({ role, flags: await readRoleFlags(admin, role) })),
  );
  for (const { role, flags } of all) {
    out(
      flags === undefined
        ? `${role}: MISSING`
        : `${role}: rolsuper=${String(flags.rolsuper)} rolbypassrls=${String(flags.rolbypassrls)} rolcreaterole=${String(flags.rolcreaterole)} rolcreatedb=${String(flags.rolcreatedb)}`,
    );
  }
});

const users = await Promise.all(
  [env.DATABASE_OWNER_URL, env.DATABASE_URL].map((url) =>
    withClient(url, async (client) => {
      const result = await client.query<{ user: string }>('SELECT current_user AS user');
      return result.rows[0]?.user ?? '?';
    }),
  ),
);
for (const user of users) {
  out(`connected as ${user}`);
}
