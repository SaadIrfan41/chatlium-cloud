/**
 * Proves each tenant isolation test fails for the right reason (build guide Step 1.8):
 * for every test, weaken the policy it covers in a fresh database and confirm that test fails.
 *
 *   pnpm --filter @chatlium/db test:isolation-proof
 *
 * Exits non-zero if any weakened run leaves its target test passing.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const ws = "nullif(current_setting('app.workspace_id', true), '')::uuid";

interface Case {
  readonly test: string;
  readonly weakening: string;
  readonly env: Record<string, string>;
}

const cases: readonly Case[] = [
  {
    test: '1.',
    weakening: 'documents tenant policy allows every row',
    env: {
      ISOLATION_WEAKEN_SQL:
        'ALTER POLICY tenant_isolation ON documents USING (true) WITH CHECK (true)',
    },
  },
  {
    test: '2.',
    weakening: 'conversations tenant policy allows every row',
    env: {
      ISOLATION_WEAKEN_SQL:
        'ALTER POLICY tenant_isolation ON conversations USING (true) WITH CHECK (true)',
    },
  },
  {
    test: '3.',
    weakening: 'documents WITH CHECK allows any workspace',
    env: { ISOLATION_WEAKEN_SQL: 'ALTER POLICY tenant_isolation ON documents WITH CHECK (true)' },
  },
  {
    test: '4.',
    weakening: 'row-level security disabled on documents',
    env: { ISOLATION_WEAKEN_SQL: 'ALTER TABLE documents DISABLE ROW LEVEL SECURITY' },
  },
  {
    test: '5.',
    weakening: 'own_memberships allows every row',
    env: { ISOLATION_WEAKEN_SQL: 'ALTER POLICY own_memberships ON memberships USING (true)' },
  },
  {
    test: '6.',
    weakening: 'documents policy checks the workspace only, not membership',
    env: {
      ISOLATION_WEAKEN_SQL: `ALTER POLICY tenant_isolation ON documents USING (workspace_id = ${ws}) WITH CHECK (workspace_id = ${ws})`,
    },
  },
  {
    test: '7.',
    weakening: 'tests connect as the superuser instead of chatlium_app',
    env: { ISOLATION_CONNECT_AS_SUPERUSER: '1' },
  },
];

/** The part of Vitest's JSON report this script reads. */
const reportSchema = z.object({
  testResults: z.array(
    z.object({
      assertionResults: z.array(z.object({ title: z.string(), status: z.string() })),
    }),
  ),
});

function failedTitles(env: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'isolation-proof-'));
  const report = join(dir, 'report.json');
  try {
    spawnSync(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        'vitest.integration.config.ts',
        'test/integration/isolation.test.ts',
        '--reporter=json',
        `--outputFile=${report}`,
      ],
      { env: { ...process.env, ...env }, stdio: 'ignore' },
    );
    const parsed = reportSchema.parse(JSON.parse(readFileSync(report, 'utf8')));
    return parsed.testResults
      .flatMap((file) => file.assertionResults)
      .filter((result) => result.status !== 'passed')
      .map((result) => result.title);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let allCaught = true;
for (const testCase of cases) {
  const failed = failedTitles(testCase.env);
  const caught = failed.some((title) => title.startsWith(testCase.test));
  allCaught &&= caught;
  const others = failed
    .filter((title) => !title.startsWith(testCase.test))
    .map((t) => t.split(' ')[0]);
  process.stdout.write(
    `${caught ? 'CAUGHT ' : 'MISSED '} test ${testCase.test} ${testCase.weakening}` +
      `${others.length > 0 ? `  (also failing: ${others.join(' ')})` : ''}\n`,
  );
}
process.exitCode = allCaught ? 0 : 1;
