/**
 * Runs the Next.js CLI with the repository-root .env loaded. Next.js reads .env files only from
 * the app folder, and Node's --env-file flag cannot be forwarded to Next's workers (they receive
 * flags through NODE_OPTIONS, which rejects it). Loading the file into this process first means
 * every worker inherits the variables. Variables already set in the environment win.
 *
 *   node scripts/next.ts dev --port 3000
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const nextCliUrl = import.meta.resolve('next/dist/bin/next');
process.argv = [
  process.argv[0] ?? process.execPath,
  fileURLToPath(nextCliUrl),
  ...process.argv.slice(2),
];
// Import by file:// URL: on Windows a plain absolute path is not a valid ESM specifier.
await import(nextCliUrl);
