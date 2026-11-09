# Build log

## Commitments (Step 0.3)

- Weekly hours available: skipped by the owner (2026-11-07)
- Total duration: skipped by the owner (2026-11-07)
- Monthly AWS ceiling: ___ (deferred to Phase 4: development is local-only with Floci until then; working target $50–100)

Step 0.3 was skipped by the owner, so the phases have no time limits. Actual time per phase is still recorded here, and limits can be added later.

## Entries

Each entry: date, step, what was done, what surprised us, time taken.

### 2026-11-05 to 2026-11-07: Phase 0 preparation

**0.1 Decision record for Cognito.** Already satisfied. Both decision files commit to Cognito, and Better Auth appears only as the rejected alternative. Two conflicts between the decision files and the guide were resolved by the owner and written into both (`usage_status` = `unknown`; in-process queue adapter for unit tests).

**0.2 Tooling.** Versions installed on 2026-11-07:

| Tool          | Version                                   |
| ------------- | ----------------------------------------- |
| Git           | 2.49.0                                    |
| Node.js       | 26.13.0 (system-wide, replaced 22.15.1)   |
| npm           | 11.20.0                                   |
| pnpm          | 12.18.0                                   |
| Docker Engine | 29.9.2 (Docker Desktop)                   |
| AWS CLI       | 2.36.29                                   |
| Terraform     | 1.12.2 (upgrade to 1.17.1 before Phase 4) |
| kubectl       | 1.36.2                                    |
| Helm          | 4.2.1 (upgrade to 4.3.1 before Phase 5)   |
| GitHub CLI    | 2.103.3                                   |
| Floci         | 2.4.0 (Docker image)                      |
| k6            | not installed yet (Phase 6)               |

`docker run hello-world` succeeded on 2026-11-07.

Surprises:

- Corepack is no longer bundled with Node 26, so pnpm is installed globally with npm.
- typescript-eslint does not support TypeScript 7, so we use oxlint with tsgolint.
- An old Floci 1.7.0 setup and old Chatlium containers, volumes and images were removed. Floci 2.4.0 was pulled fresh and smoke-tested: FIFO dedup, Cognito discovery with PKCE S256, S3 versioning and Secrets Manager all work.
- The Claude app's terminal tabs keep the PATH from when the app started, so newly installed tools need an app restart.

**0.4 Accounts.** GitHub CLI is logged in as SaadIrfan41. The existing private repo `chatlium` holds an older, unrelated build and is left untouched. The greenfield repo is `chatlium-cloud`. The AWS account and budget alerts are deferred to Phase 4. A Gemini API key is needed by Step 2.5.

**0.5 Repository skeleton (2026-11-07).** Created the README, ADR 0001, this log, the PR template, `.gitignore`, `.editorconfig` and `.gitattributes`, and added the decision files, guide, research and project skills. Initial commit `f8cafd6` was pushed to the new private repo https://github.com/SaadIrfan41/chatlium-cloud (`main`).

Surprises:

- **Branch protection was blocked on the private repo:** GitHub returned HTTP 403 "Upgrade to GitHub Pro or make this repository public". The owner chose to **make the repository public**.
- Before going public, commits were switched to GitHub's noreply address so the personal email is not published. This repo's `user.email` is `75434031+SaadIrfan41@users.noreply.github.com`, and the single initial commit was rewritten and force-pushed.
- The guide's "one approval, self-approve if alone" does not work on GitHub, which never lets a PR author approve their own PR. Protection is set to require a pull request with **0 approvals**. Required CI status checks become the merge gate in Step 1.13.

Protection on `main`: pull request required, applied to admins too, stale reviews dismissed, conversations must be resolved, no force pushes, no deletion.

### 2026-11-07: Phase 1 — Foundation and tenant isolation

**1.1 Initialize the monorepo.** Root `package.json` (`private`, `packageManager: pnpm@12.18.0`, `engines` Node 26 / pnpm 12), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), Turborepo 2.11.10 with `build`, `lint`, `typecheck` and `test` tasks, and `packages/tsconfig` with a strict base config (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `es2025`, `nodenext`). Lint uses oxlint with `--type-aware` (tsgolint) and one root `.oxlintrc.json`. Formatting uses Prettier. Pinned: typescript 7.0.2, oxlint 1.91.0, oxlint-tsgolint 7.0.2006, prettier 3.9.10.

Done-when evidence (empty workspace): `pnpm install --frozen-lockfile`, `pnpm lint` and `pnpm typecheck` all exit 0. `pnpm format:check` passes.

Proof that the checks are not passing for the wrong reason: a temporary package with a deliberate `number | undefined` assignment, a floating promise and a `console.log` was added. `typecheck` failed with TS2322, `lint` failed with `typescript(no-floating-promises)` and `no-console` (from the root config, read from inside the package). After the code was fixed both passed. The probe package was then deleted.

Surprises:

- **pnpm 12 has a supply-chain release-age delay.** Installing oxlint 1.92.0, published about 7 hours earlier, made pnpm write `minimumReleaseAgeExclude` entries for it into `pnpm-workspace.yaml`. Owner decision: pin **oxlint 1.91.0** (2026-11-03), which passes the delay, and keep no exceptions. Policy: we do not add release-age exceptions; Renovate (Step 1.13) proposes newer versions once they age.
- Turborepo's `transit` task pattern lets `lint` and `typecheck` run in parallel while still re-running when an internal dependency changes.
- Turborepo prints "No tasks were executed" on the empty workspace and exits 0. This is expected until packages with scripts exist.

**1.2 Configuration package (2026-11-07).** `packages/config`: a Zod 4.6.7 schema covering every environment variable known so far (`NODE_ENV`, `LOG_LEVEL`, `APP_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `AWS_REGION`, `AWS_ENDPOINT_URL` for Floci only, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_ISSUER`, `SESSION_SEALING_KEY`, `GEMINI_API_KEY_SECRET_ID`). `loadConfig()` returns a frozen config, or throws a `ConfigError` that lists every problem by variable name and never includes a value. Empty strings count as missing. Tests use Vitest 5.1.0.

Decisions made in this step:

- `COGNITO_ISSUER` is explicit configuration rather than derived from the pool ID, because Floci issues `http://<floci-host>/<poolId>` and AWS issues `https://cognito-idp.<region>.amazonaws.com/<poolId>`.
- The Gemini key is **not** an environment variable. Processes get the Secrets Manager secret ID (`GEMINI_API_KEY_SECRET_ID`) and fetch the key at runtime. The decision record says the key never touches the repo.
- `packages/tsconfig` gained `rewriteRelativeImportExtensions` and `erasableSyntaxOnly`, so packages import `./file.ts` and Node 26 can run TypeScript directly.

Done-when evidence:

- Tests: 7 passed. The guide's three (complete env parses; a missing variable is named; a malformed value fails) plus: a missing URL variable says "is required"; all problems are listed at once; a secret value never appears in the error; defaults apply.
- Broken environment at startup (Node 26, `mysql://u:hunter2-secret@db/x` and a short sealing key): exit code 1, with `Invalid configuration (8 problem(s))` listing each variable and its problem. Neither secret appears in the output.

Proof that the tests fail for the right reasons (mutation checks, each reverted afterwards):

- Error text echoes the value → 3 tests fail, including the secret-leak test.
- `DATABASE_URL` accepts any string → the malformed-value test fails.
- Missing variables reported with the raw schema message → **initially no test failed.** This exposed a gap: only a plain-string variable had been tested as missing. Added a test for a missing URL variable, which now fails under this mutation.

Surprise: the mutation check found a real test gap on the first run. Keep doing it for every step.

**1.3 Structured logger (2026-11-07).** `packages/observability` with Pino 10.4.0. `createLogger({ service, level, destination })` writes JSON lines with `time` (ISO 8601), `level` (as a label), `service` and `msg`. `withContext(logger, { workspaceId, requestId })` returns a child logger that adds `workspace_id` and `request_id`. Redaction replaces the value of any field whose name contains `authorization`, `cookie`, `password`, `passwd`, `secret`, `token` or `key` (case-insensitive, at any depth, inside arrays and errors). Circular references and very deep objects are handled.

Decision: redaction is key-based rather than path-based. Pino's `redact` option only takes exact paths such as `req.headers.cookie`, so it cannot express the guide's "any field whose name matches `*key*`" at any depth. A sanitizer runs in Pino's `log` and `bindings` formatters and as the `err` serializer.

Done-when evidence: 8 tests pass. The redaction test logs a fake secret in 8 different sensitive fields (top-level, nested headers, 4 levels deep, inside an array) and asserts the raw output does not contain it. Other tests cover: line format, non-sensitive fields kept, errors keep message and stack and have secrets redacted, circular references, child context fields, and child bindings redacted.

Surprises (both caught by the tests on the first run):

- **Pino's `formatters.bindings` does not apply to `logger.child(bindings)`.** A `sessionToken` passed as a child binding was printed in plain text. Fix: `child` is wrapped so child bindings are redacted at every level.
- **Copying an `Error` as a plain object loses `message` and `stack`**, which are not enumerable, and Pino's own `err` serializer hid them from the sanitizer. Fix: the sanitizer copies them explicitly and replaces the `err` serializer.
- oxlint's `no-unsafe-type-assertion` rejected `as` casts. Replaced them with typed functions and type guards.

Mutation checks (each reverted): dropping the `key` pattern, not recursing into nested objects, removing child-binding redaction, and dropping the error message each make exactly one test fail.

**1.4 Local infrastructure (2026-11-07).** `docker-compose.yml` (project `chatlium`) runs:

- `postgres`: `pgvector/pgvector:0.8.7-pg18-trixie` (PostgreSQL 18.6, pgvector 0.8.7), pinned by tag and digest `sha256:5895949d…`
- `redis`: `redis:8.10.3-alpine` with append-only persistence, pinned by digest `sha256:71885d8c…`

Both have health checks, named volumes, and ports bound to `127.0.0.1` only. Credentials come from `.env` (gitignored). `.env.example` documents the variables, and Compose refuses to start if they are missing. The local `.env` was generated with a random password.

Done-when evidence:

- `docker compose up -d --wait`: exit 0, both containers `healthy`.
- `psql` (the container's client over TCP; no psql on the host): `CREATE EXTENSION vector` succeeded, and `pg_extension` shows `vector 0.8.7`.
- Beyond the guide: a temp table with `vector(3)`, an HNSW `vector_cosine_ops` index, and a cosine-distance query returned the expected order (0.0000, 0.0061, 1.0000). `redis-cli ping` returned `PONG`, version 8.10.3.
- Persistence: after `docker compose down` and `up`, the extension is still present, so the volume path is correct.

Surprise: **PostgreSQL 18 images moved their data directory** to `/var/lib/postgresql/18/docker` and declare `/var/lib/postgresql` as the volume. Mounting the old `/var/lib/postgresql/data` path would make data disappear silently on recreate. The volume is mounted at `/var/lib/postgresql`.

**1.5 Database package and roles (2026-11-07).** `packages/db` with Drizzle ORM 0.45.4, drizzle-kit 0.31.11 and node-postgres 8.23.1. `bootstrapRoles()` creates `chatlium_owner` and `chatlium_app` and their privileges. It is run with `pnpm --filter @chatlium/db db:bootstrap` as the administrator, and `db:verify-roles` prints the role check. See [ADR 0002](adr/0002-database-roles-and-driver.md) for why roles are bootstrapped rather than created by a migration.

Done-when evidence (local database):

```
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'chatlium_app';
 rolsuper | rolbypassrls
----------+--------------
 f        | f
connected as chatlium_owner
connected as chatlium_app
```

Running the bootstrap twice is harmless.

Integration test (Testcontainers, a fresh PostgreSQL 18 + pgvector container, about 13 s): 8 tests pass. They cover the app and owner role flags, the app connects, pgvector is present, the app cannot run DDL, the app gets DML only on owner-created tables (no `TRUNCATE` or `DROP`), drifted flags are reset, and other roles cannot connect.

Mutation checks (each reverted):

- Drop `NOBYPASSRLS` → drift test fails
- Drop `NOSUPERUSER` → drift test fails
- Grant `ALL` instead of DML → DML-only test fails
- Give the app `CREATE` on the schema → DDL test fails
- Leave `CONNECT` for `PUBLIC` → outsider test fails. My first attempt at this mutation used invalid SQL, so setup crashed and all tests were _skipped_. A skipped run is not a caught mutation. It was redone with a valid no-op.

Surprises:

- **Postgres already creates roles as non-superuser and without BYPASSRLS by default**, so a test on a freshly created role cannot tell whether the code enforces those flags. The drift test, where the role is made superuser with BYPASSRLS first and the bootstrap must reset it, is what actually proves the code.
- **pnpm 12 blocks dependency install scripts** (`ERR_PNPM_IGNORED_BUILDS`) for esbuild, ssh2, cpu-features and protobufjs. All four are denied in `allowBuilds`; drizzle-kit's esbuild and Testcontainers work without them.
- oxlint required named imports from `pg` (`import { Pool } from 'pg'`).
- Drizzle's `drizzle.config.ts` and migrations start in Step 1.6. No tables exist yet.

**1.6 Phase 1 schema and RLS migration (2026-11-09).** `packages/db/src/schema.ts` defines `users`, `workspaces`, `memberships` (unique on workspace and user), `documents` and `conversations`, with enums for role, document status and conversation status. IDs default to PostgreSQL 18's `uuidv7()` (time-ordered). `drizzle/0000_init.sql` is generated by drizzle-kit. `drizzle/0001_rls.sql` is hand-written: ENABLE and FORCE row-level security on the three tenant tables, `tenant_isolation` on documents and conversations, and `own_memberships` (SELECT, keyed on `app.user_id`) plus `membership_write` (keyed on `app.workspace_id`) on memberships, all with `nullif(current_setting(..., true), '')`. `runMigrations()` and `pnpm --filter @chatlium/db db:migrate` apply migrations as `chatlium_owner`.

Done-when evidence (local database):

- The migration applied to the empty database.
- `\d+ documents` shows `Policies (forced row security enabled)` with `tenant_isolation`.
- `pg_class`: `relrowsecurity` and `relforcerowsecurity` are true for memberships, documents and conversations, false for users and workspaces. All tables are owned by `chatlium_owner`.
- A second `db:migrate` is a no-op: 2 migrations recorded before and after.
- `drizzle-kit check` reports "Everything's fine", and `drizzle-kit generate` reports "No schema changes".

Integration tests (fresh container): 8 new tests, 16 in total for the package. They cover the tables and their owner, RLS enabled and forced, the exact policy list, the second run being a no-op, **FORCE applying to the owner** (the superuser sees the row, the owner with no context sees none), failing closed on an empty-string setting, DML-only default privileges on all 5 tables, and the migration history being unreadable by the app.

Mutation checks (each reverted):

- Drop FORCE on documents → 2 tests fail
- Drop `nullif` on documents → empty-string test fails
- Forget ENABLE on conversations → RLS-flags test fails
- Expose the `drizzle` schema → migration-history test fails

Surprises:

- **Drizzle's migrator needs `CREATE` on the database** even when its schema already exists, because PostgreSQL checks the privilege before existence. The bootstrap now creates the `drizzle` schema (owned by the owner, closed to everyone else) and grants the owner `CREATE` on the database. ADR 0002 is updated.
- **`nullif` matters only on reused connections.** In a fresh session an unset setting is NULL and returns no rows anyway. After a transaction-local `set_config`, the session reads `''`, and without `nullif` the query raises `invalid input syntax for type uuid` instead of failing closed. The new test pins this behavior down.
- Drizzle cannot express `FORCE ROW LEVEL SECURITY`, so RLS lives in a custom migration. drizzle-kit ignores policies it does not manage, so later `generate` runs leave them alone (`generate` reports no changes).

**1.7 Tenant context helpers (2026-11-09).** `packages/db/src/tenant.ts`:

- `withWorkspace(db, workspaceId, fn)` and `withUser(db, userId, fn)` run `fn` in a transaction after `SELECT set_config('app.workspace_id' | 'app.user_id', $1, true)`. The value is a bind parameter, never string interpolation (`SET LOCAL` cannot take parameters), and the setting is transaction-local.
- IDs are validated as UUIDs first. A non-UUID throws `InvalidTenantIdError` before any SQL runs.
- A shared test fixture, `startMigratedDatabase()`, starts a container, bootstraps roles and runs migrations. Step 1.8 reuses it.

Done-when evidence: with a pool of **one** connection, the backend PID is the same before and after `withWorkspace(A)`, and the next transaction reads `app.workspace_id` as unset. 8 tests pass (24 in the package). They cover: the context is set inside only; no leak on the same connection; no leak and rollback when the callback throws; RLS scopes reads to the workspace; two concurrent transactions on two connections each see only their own workspace (overlapped with `pg_sleep`); a SQL-injection string is rejected with no SQL run and no data lost; `withUser` sets only `app.user_id` and clears it afterwards.

Mutation checks (each reverted):

- `set_config(..., false)` (session-level) → 3 tests fail. The workspace leaks into the next transaction, and even into a later `withUser` call
- Skip UUID validation → injection test fails
- Never set the workspace → 4 tests fail
- `withUser` sets the wrong setting → 1 test fails

Not caught by behavior: rewriting `set_config` as `SET LOCAL` with string interpolation passes, because UUID validation already blocks injection. The code-level rule (bind parameters only) is enforced by review and stated in the function's doc comment.

**1.8 Isolation tests (2026-11-09).** `packages/db/test/integration/isolation.test.ts` contains the guide's seven tests. Data is seeded through `chatlium_owner` (subject to RLS because of FORCE), and every assertion runs as `chatlium_app`:

1. A's user cannot read B's documents (as a member and as a worker)
2. A's user cannot read B's conversations
3. Inserting a document with B's ID in A's context fails with `new row violates row-level security policy`, and nothing is written
4. With no context, zero rows from documents, conversations and memberships
5. `withUser(A)` returns only A's own membership rows
6. A member of A only, acting through `withWorkspace(B)`, reads zero documents, conversations and memberships of B, and cannot insert into B
7. The app role is not a superuser and does not bypass RLS

Design change (owner decision, [ADR 0003](adr/0003-membership-aware-rls.md)): test 6 could not pass with the Step 1.6 policies, which compared only the workspace. `withWorkspace` now takes `{ workspaceId, userId? }`, and migration `0002_membership_aware_rls.sql` makes the tenant policies require membership whenever a user is set. Workers, with no user, keep the workspace-only rule. `memberships` cannot reference itself in a policy (infinite recursion), so its workspace-wide view is limited to system contexts.

Done-when evidence: the 7 tests pass locally (31 integration tests in the package). They will also pass in CI once Step 1.13 adds it.

**Failing for the right reason** (guide requirement), via `pnpm --filter @chatlium/db test:isolation-proof`. It re-runs the suite on a fresh database with one policy weakened at a time:

```
CAUGHT  test 1. documents tenant policy allows every row  (also failing: 3. 4. 6.)
CAUGHT  test 2. conversations tenant policy allows every row  (also failing: 4. 6.)
CAUGHT  test 3. documents WITH CHECK allows any workspace  (also failing: 6.)
CAUGHT  test 4. row-level security disabled on documents  (also failing: 1. 3. 6.)
CAUGHT  test 5. own_memberships allows every row  (also failing: 4. 6.)
CAUGHT  test 6. documents policy checks the workspace only, not membership
CAUGHT  test 7. tests connect as the superuser instead of chatlium_app  (also failing: 1. 2. 3. 4. 5. 6.)
```

Test 6 is the only test that catches a workspace-only policy. Connecting as the superuser fails all seven, which is the guard Step 1.5 asked for.

Surprises:

- **The guide's own policies could not satisfy its test 6.** Resolved by ADR 0003.
- **A bare `toThrow()` would accept any error**, for example a typo, as "isolation works". Both rejection tests now assert the exact PostgreSQL message, which Drizzle wraps as `cause`.
- The isolation proof takes about 70 s (7 fresh containers). It is a script rather than part of the normal integration run.
- `EXPLAIN` confirms the membership check runs once per query: `InitPlan 1` uses an **Index Only Scan** on `memberships_workspace_user_key`, and documents are found through `documents_workspace_id_idx`.

**1.9 Cognito user pool, development (2026-11-09).** Owner decision (2026-11-06): development Cognito runs in **Floci**. Checked against Floci 2.4.0's documentation: managed login supports the authorization code flow with PKCE S256, `nonce`, discovery and JWKS, refresh and revocation. So no AWS account is needed yet.

- `docker-compose.yml` gains `floci` (`floci/floci:2.4.0`, pinned by digest): persistent storage, localhost-only port 4566, no Docker socket, and a bash `/dev/tcp` health check because the image has no curl.
- `packages/dev-tools`: `cognito:setup` creates or updates the user pool `chatlium-dev` (email sign-in, 12+ character password policy, optional TOTP MFA, admin-created users only), the app client `chatlium-web`, and two test users. It is idempotent, refuses to run against a non-local endpoint, and writes the IDs, the client secret and random test passwords to `.env` without printing them. `cognito:check` walks the hosted sign-in flow as a browser would.
- Client secret decision: confidential client **plus** PKCE, see [ADR 0004](adr/0004-cognito-app-client-secret.md).

Done-when evidence (`cognito:check`):

```
1. authorize        -> HTTP 302 redirect to /cognito-idp/login
2. sign-in form     -> HTTP 200, CSRF token present
3. submit password  -> HTTP 302 redirect to http://localhost:3000/api/auth/callback?code=<43 chars>&state=<matches>
4. redeem code      -> HTTP 200; ID token iss ok, aud ok, token_use ok, nonce ok, exp ok
OK: hosted sign-in redirects to the callback with an authorization code.
```

Negative checks: a callback URL differing only in its port (3001) gets HTTP 400 `redirect_uri is not registered for this client`, which is the guide's exact-match watch-out. A wrong password gets no redirect and no code. After `docker compose restart floci` the pool, issuer and sign-in still work, so persistent storage works.

Surprises:

- Floci's issuer is `http://localhost:4566/<poolId>` (AWS: `https://cognito-idp.<region>.amazonaws.com/<poolId>`), which is why `COGNITO_ISSUER` is explicit configuration (Step 1.2). It stays consistent in Phase 1 only because the browser and the dev server both use `localhost`. Phase 3 (web app in a container) must handle the browser seeing `localhost` while the server sees `floci`.
- The AWS SDK resolved to `3.1164.0`, published 2.6 days earlier, so it passes pnpm's release-age delay with no exception.
