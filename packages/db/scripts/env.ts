import { z } from 'zod';

/**
 * Environment for database maintenance scripts (bootstrap, verification, migrations).
 * Kept separate from @chatlium/config on purpose: application processes never receive
 * the admin or owner credentials.
 */
const scriptEnvSchema = z.object({
  DATABASE_ADMIN_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
  DATABASE_OWNER_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
  CHATLIUM_OWNER_PASSWORD: z.string().min(24, { error: 'must be at least 24 characters' }),
  CHATLIUM_APP_PASSWORD: z.string().min(24, { error: 'must be at least 24 characters' }),
});

export type ScriptEnv = z.infer<typeof scriptEnvSchema>;

export function loadScriptEnv(): ScriptEnv {
  const result = scriptEnvSchema.safeParse(process.env, { reportInput: false });
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.map(String).join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid database script environment:\n${problems.join('\n')}`);
  }
  return result.data;
}

/** The database name from a connection URL. */
export function databaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (name === '') {
    throw new Error('connection URL has no database name');
  }
  return name;
}
