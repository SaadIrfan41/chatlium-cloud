import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The repository's local .env (gitignored). */
export const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * Sets keys in the local .env file, replacing existing lines and appending new ones.
 * Values are never printed.
 */
export function upsertEnv(values: Readonly<Record<string, string>>): void {
  const lines = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  const pending = new Map(Object.entries(values));
  const updated = lines.map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
    if (key === undefined || !pending.has(key)) {
      return line;
    }
    const value = pending.get(key) ?? '';
    pending.delete(key);
    return `${key}=${value}`;
  });
  while (updated.length > 0 && updated.at(-1) === '') {
    updated.pop();
  }
  if (pending.size > 0) {
    updated.push(
      '',
      '# Written by `pnpm --filter @chatlium/dev-tools cognito:setup` (Floci, local only)',
    );
    for (const [key, value] of pending) {
      updated.push(`${key}=${value}`);
    }
  }
  writeFileSync(ENV_FILE, `${updated.join('\n')}\n`);
}
