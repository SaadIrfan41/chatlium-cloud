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

**1.10 Web application skeleton and sign-in (2026-11-09).**

- `apps/web`: Next.js 16.4.5 (App Router, Turbopack), React 19.3, Tailwind 4.3, shadcn/ui 4.23 (Base UI, `base-nova`), TypeScript 7. **Next 16.4 supports TypeScript 7**: `next build` runs the project's own `tsc` CLI (documented in its bundled docs), so no workaround is needed.
- `packages/crypto`: `createSealer(secret, purpose)` seals cookies as compact JWE (`dir` + `A256GCM`) with a per-purpose key derived by HKDF, and expiry inside the ciphertext. 9 tests: round trip, encryption hides the payload, tamper, wrong key, wrong purpose, expiry at 59 s and 61 s, schema mismatch, garbage input, short secret.
- Routes:
  - `GET /api/auth/login` creates a fresh PKCE verifier, `state` and `nonce`, seals them into a 10-minute cookie, and redirects to Cognito.
  - `GET /api/auth/callback` checks the sealed transaction and `state`, redeems the code server-side (PKCE plus client secret), and verifies the ID token (openid-client checks signature, `iss`, `aud`, `exp` and `nonce`; `token_use=id` is checked explicitly). It then sets the sealed session cookie.
  - `POST /api/auth/logout` requires a trusted `Origin` **and** the session's CSRF token, revokes the refresh token, clears the cookie, and redirects to Cognito's sign-out.
  - The callback URL is built from `APP_BASE_URL`, never from the request's `Host` header.
- UI per [ADR 0005](adr/0005-ui-stack-and-design.md): a sign-in page whose hero is a sample conversation (teal grounded answer, amber hand-off), and a signed-in home with an account menu (email, Light / Dark / Match my device, Sign out). WCAG 2.2 AA contrast is computed for 22 pairs, plus a skip link, landmarks and reduced motion.
- `@chatlium/config` gains `COGNITO_CLIENT_SECRET`. `apps/web/scripts/next.ts` loads the repository-root `.env`, then runs the Next CLI in-process.

Done-when evidence, in the built-in browser with test user A:

- Sign in: `/` → Floci hosted form (URL carries `code_challenge_method=S256`, `state` and `nonce`) → `/api/auth/callback` → `/dashboard` ("You're signed in").
- In the page: `document.cookie` is `""`, so the session cookie is HttpOnly. `localStorage` and `sessionStorage` have **no keys**, and no JWT appears in the HTML.
- Sign out (the account menu's form): back to `/`, and `/dashboard` then redirects to `/`.
- `pnpm --filter @chatlium/dev-tools web:auth-check` (repeatable):
  ```
  login     Set-Cookie chatlium_signin=<401 chars>; Path=/; Max-Age=600; HttpOnly; SameSite=lax
  callback  Set-Cookie chatlium_session=<777 chars>; Path=/; Max-Age=604800; HttpOnly; SameSite=lax
  callback  -> HTTP 303 /dashboard
  sign-out without Origin        -> HTTP 403
  sign-out with wrong CSRF token -> HTTP 403
  sign-out                       -> HTTP 303 /cognito-idp/logout   (session cookie cleared)
  dashboard after sign-out       -> HTTP 307 /
  ```
  `Secure` and the `__Host-` prefix are applied automatically when `APP_BASE_URL` is https. They are absent only on `http://localhost`.
- At phone width (375 px) there is no horizontal overflow, the light theme applies, and the headline uses its 75% width.

Surprises:

- **Next.js reads `.env` only from the app folder.** `@next/env`'s `loadEnvConfig` caches its first result, so calling it from `next.config.ts` did nothing. Node's `--env-file` cannot be forwarded to Next's workers, because `NODE_OPTIONS` rejects it. Fix: a tiny launcher (`scripts/next.ts`) uses Node's built-in `process.loadEnvFile()` and then runs the Next CLI in the same process. On Windows, dynamic `import()` needs a `file://` URL, not a path.
- The first broken start showed the Step 1.2 config error doing its job: every missing variable listed by name, and no values.
- The shadcn CLI added a package literally called `cn`. It was checked before use: it is shadcn's own (`github.com/shadcn-ui/cn`), a compiled replacement for `clsx` + `tailwind-merge`.
- The browser pane was hidden during testing, so clicks could not be delivered. Form submission used `requestSubmit()`, which is equivalent to clicking the submit button.

**1.11 Token verification and session loading (2026-11-09).** New package `packages/auth`:

- `createIdTokenVerifier({ issuer, clientId })` → `verifyIdToken(token)`: checks the RS256 signature against the pool's JWKS (`<issuer>/.well-known/jwks.json`, cached by jose), `iss`, `aud` (the client ID), `exp` (5 s tolerance) and `token_use === 'id'`, and requires `sub` and `email`. Failures throw `InvalidIdTokenError` with a loggable reason, never the token.
- `createSessionStore(...)` → `requireSession(request)`: reads the sealed cookie, unseals it (authenticated, with expiry inside), and returns `{ userId, cognitoSub, email, csrf }`, or throws `UnauthenticatedError`.
- `refreshIfStale(session, { refresh, verifyIdToken })` implements the decision record's "access tokens 15 minutes, refreshed on the server". While the last ID token is valid it does nothing. After that it redeems the refresh token, re-verifies the new ID token and requires the same `sub`. If Cognito refuses, verification fails or the user changed, the session ends.
- `packages/db`: `upsertUserByCognitoSub()` creates the application user on first sign-in. Later sign-ins keep the same ID and refresh the email. It runs as `chatlium_app`.
- Web: the callback verifies with `@chatlium/auth`, creates the user, and stores `userId` and `idTokenExpiresAt` in the session. A new `src/proxy.ts` (Next 16's renamed middleware, on the Node runtime) refreshes stale sessions before the page renders, or removes the cookie if the refresh is refused.

Done-when evidence (the guide's four invalid cases, plus more): 21 tests in `packages/auth`. Rejected: expired, wrong audience, wrong issuer, an access token used as an ID token, a key not in the JWKS, `alg: none`, an HS256 algorithm-confusion token, and no email. Accepted: a valid token. Session: a valid cookie, missing, tampered, foreign secret, and a non-UUID user ID. Refresh: fresh untouched, stale refreshed, refreshed 30 s early, revoked, forged new token, a different user, and no refresh token.

Live, against Floci (`pnpm --filter @chatlium/dev-tools web:auth-check`):

```
session holds userId 01a1c068-b8dc-7f72-ac49-0434df422f45 (an application UUID)
stale session  -> HTTP 200, refreshed server-side: true (ID token now valid for 900 s)
revoked token  -> revoke HTTP 200; dashboard HTTP 307 /, session cleared: true
```

The browser sign-in created the `users` row (UUIDv7 ID linked to the Cognito `sub`), and `/dashboard` renders for that user.

Mutation checks (each reverted): dropping the audience, issuer or `token_use` checks, skipping the same-user check on refresh, or keeping the session when a refresh fails each fail their test. **Not caught:** removing the RS256 allow-list. jose already refuses `none` and only uses a JWKS key whose type matches the algorithm, so algorithm confusion fails either way. That makes it an equivalent mutant; the pin stays as defense in depth, and an explicit HS256 confusion test was added.

Surprises:

- **Turbopack treats `new URL('../drizzle', import.meta.url)` as a bundled asset** and failed on the migrations folder. The real fix was a design one: `@chatlium/db` now has two entry points, the runtime API (`.`) and `./admin` (role bootstrap and migrations). The web app no longer bundles administrative code.
- Floci keeps a managed-login session cookie, so a second sign-in skipped the form. That matches AWS behaviour.
- `seal()` threw synchronously on a schema error. It is now `async`, so callers always get a rejected promise.

**1.12 Membership and role checks (2026-11-09).**

- `packages/auth`: `createWorkspaceGuard({ sessions, lookupRole })` → `requireWorkspaceRole(request, workspaceId, minimumRole)`. It calls `requireSession`, then looks up the caller's own membership (`withUser`, so the `own_memberships` policy applies), and returns `{ user, workspaceId, role }`. Roles rank `operator < admin < owner`. Every refusal throws the same `ForbiddenError`, with no reason attached: not a member, role too low, no such workspace, or not even a UUID (rejected before any query). The membership lookup is injected, so the package stays free of a database dependency and unit-testable.
- `packages/db`: `findMembershipRole`, `listUserWorkspaces` (through `withUser`) and `listDocuments` (through `withWorkspace({ workspaceId, userId })`, and also filtered by `workspace_id` explicitly). A new `@chatlium/db/testing` entry exposes the Testcontainers fixture to other packages' tests.
- Web: `GET /api/workspaces` and `GET /api/workspaces/:id/documents` (operator or higher). Handlers live in `src/server/api/workspaces.ts` without `server-only`, so integration tests drive them directly; the route files only wire them. Responses are `no-store`. A missing session gives `401 {"error":"unauthenticated"}`; every authorization failure gives the byte-identical `403 {"error":"forbidden"}`.
- The dashboard lists the signed-in user's workspaces with their role.
- Lint now forbids `@chatlium/db/admin` and `@chatlium/db/testing` in `apps/*/src` (probed with a deliberate import, then removed).
- Dev tools: `db:seed-dev` (idempotent; looks up each Floci test user's `sub`, so the seeded user row is the one sign-in uses) creates Acme Support (operator.a, operator) and Beta Help Desk (operator.b, admin). `web:workspace-check` is the guide's manual check.

Done-when evidence: 9 integration tests in `apps/web` against a migrated Postgres, as `chatlium_app`. A member gets 200 with only their own workspace's documents, and a higher role also passes. A non-member's 403 equals, in status, content type, cache header and body, the 403 for a non-existent workspace and for a malformed ID. A user with no memberships gets the same 403. A role below the minimum gets 403 (operator is the lowest role, so this is checked through the guard with `admin`/`owner` minimums against the real lookup). No session gets 401. `/api/workspaces` lists only the caller's own workspaces. Plus 15 unit tests for the guard and the role ranking.

Live (`pnpm --filter @chatlium/dev-tools web:workspace-check`):

```
operator.a@chatlium.test sees: Acme Support (operator)
operator.b@chatlium.test sees: Beta Help Desk (admin)
ok   operator.a@chatlium.test: own workspace documents -> 200 (Refund policy, Shipping times)
ok   operator.a@chatlium.test: other tenant's workspace -> 403 {"error":"forbidden"}
ok   operator.a@chatlium.test: non-existent workspace   -> 403 {"error":"forbidden"} (identical)
ok   operator.b@chatlium.test: own workspace documents -> 200 (Account recovery)
ok   operator.b@chatlium.test: other tenant's workspace -> 403 {"error":"forbidden"}
ok   operator.b@chatlium.test: non-existent workspace   -> 403 {"error":"forbidden"} (identical)
ok   no session: GET /api/workspaces -> 401
```

In the browser, operator.a's dashboard shows only Acme Support (Operator).

Mutation checks (each reverted): ranking with `>` instead of `>=`, skipping the role comparison, skipping the UUID check (a malformed ID then reaches Postgres and errors), looking up the membership without the workspace condition, adding a reason to the 403 body, and dropping `no-store` each fail a test. **Not caught:** removing the explicit `workspace_id` filter from `listDocuments`. Row-level security still returns only the workspace's rows, so this mutant is equivalent while RLS is on. The filter stays as defense in depth, and RLS itself is proven by `test:isolation-proof`.

**1.13 Continuous integration (2026-11-09).**

- `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It has two jobs, both required on `main`:
  - **Lint, typecheck, unit tests, build:** `format:check`, `lint`, `typecheck`, `test` and `build`.
  - **Integration tests:** `test:integration`, using Testcontainers on the runner's Docker with the same digest-pinned pgvector image as Compose.
- Node comes from `.nvmrc`. pnpm comes from `packageManager` through `pnpm/action-setup`, because Node 26 does not bundle Corepack. Dependencies install with `--frozen-lockfile`, and the pnpm store is cached by `actions/setup-node`.
- Hardening:
  - Every action is pinned to a commit SHA, with the version in a comment. Versions are the latest releases: checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.1.
  - `permissions: contents: read` and `persist-credentials: false`.
  - The workflow uses no secrets.
  - A new push cancels the older run of the same PR.
- Branch protection on `main` now also requires both checks, with `strict` set so the branch must be up to date. The checks are bound to the GitHub Actions app (ID 15368), so a commit status from another source cannot satisfy them. All existing rules are unchanged.
- `renovate.json`:
  - Runs weekly, Monday 00:00–05:59 UTC.
  - Grouped PRs: all non-major npm updates, GitHub Actions (including pinned digests), container images, and oxlint together with oxlint-tsgolint. Each major update gets its own PR.
  - Weekly lockfile maintenance and `pnpmDedupe`.
  - `minimumReleaseAge: 3 days`, so Renovate never proposes a version that pnpm 12's release-age delay would reject (the policy is no `minimumReleaseAgeExclude` entries).
  - A custom regex manager keeps the Testcontainers image in `packages/db/test/integration/postgres.ts` on the same digest as `docker-compose.yml`.
  - Validated with `renovate-config-validator --strict`.

Surprise: before the first push, the CI steps were run in a fresh clone with no `.env`. Web lint failed. It relied on Next's generated `RouteContext` type, which existed only in the local `.next` folder. The web `lint` script now runs `next typegen` first. Running the steps clean caught this before it could become a red CI run on GitHub.

Done-when evidence, from probe PR #14 (closed, never merged):

1. Added `packages/config/test/ci-probe.test.ts`, which asserts `1 + 1 === 3`. CI showed **Lint, typecheck, unit tests, build: fail** (`AssertionError: expected 2 to be 3`) and **Integration tests: pass**.
2. With the PR marked ready for review, GitHub reported `mergeable: MERGEABLE` (no conflicts) and `mergeStateStatus: BLOCKED`. The failing required check was the only remaining cause.
3. Removing the test made both checks pass (unit job 40 s, integration job 53 s), and the PR became `CLEAN`, so it could be merged. It was closed instead.

**1.13 follow-up: Renovate config fixes (2026-11-09).** Renovate was enabled on the Mend portal. It is installed as "Silent" by default, which scans but opens nothing, so "Automated PRs" was switched on and "Require config file" left on. Its first run created the Dependency Dashboard (issue #15) and showed three gaps, now fixed and confirmed by a local `renovate --platform=local --dry-run=lookup`:

- `config:recommended` ignores `**/test/**`, so the Testcontainers image pin was never seen. `ignorePaths` now excludes only `node_modules`, and the regex manager detects `pgvector/pgvector` in `postgres.ts`.
- `rangeStrategy: pin` would have pinned the `engines` ranges for Node and pnpm. A rule keeps them as ranges (`replace`).
- `packages/config` had `"@types/node": "^26.6.6"`, the only non-exact version in the repo. It is now `26.6.6`.

## Phase 2: Vertical slice

**2.1 Queue interface and local adapter (2026-11-09).** New package `packages/queue`.

- `MessageQueue<T>`: `publish(body, { groupId?, deduplicationId?, attributes? })`, `consume(handler, { concurrency })` returning a `Consumer` with `stop()`, plus `ack` and `nack`. A handler that resolves acks; one that throws nacks. The semantics are SQS's, so the Phase 3 SQS adapter can be a drop-in:
  - At-least-once delivery.
  - FIFO groups are delivered one at a time in publish order, and different groups run concurrently.
  - FIFO deduplication uses a 5-minute window.
  - Visibility timeout and redelivery.
  - Dead-lettering after `maxReceiveCount` deliveries.
  - Every delivery gets its own `receipt`, so a late ack from a timed-out delivery cannot delete the redelivered copy.
  - `attributes` carries string metadata such as `traceparent`, for tracing across the queue later.
- Bodies are validated with a Zod schema on publish and travel as JSON, as on a real queue. FIFO sends need a group and a deduplication ID, and standard queues reject deduplication IDs, as SQS does.
- `createInProcessQueue({ kind, schema, maxReceiveCount, visibilityTimeoutMs })` is the in-process adapter. It is for unit tests in every phase, and the development queue only in Phase 2 (decisions: SQS on Floci from Phase 3). It also offers `deadLetters()` and `whenIdle()`.
- The contract tests from amendments §3 are one reusable suite, `@chatlium/queue/contract` → `describeQueueContract(name, factory, timing)`. The in-process adapter runs it now, and the SQS adapter will run the same suite against Floci (and real SQS before the production demo). It covers: delivery exactly once (standard and FIFO), redelivery up to the limit then the DLQ, a transient failure recovering, FIFO order within a group, two consumers on different groups at once (never the same group twice), deduplication, visibility-timeout redelivery, and crash recovery with an idempotency check giving one side effect.

Done-when evidence: 15 tests pass, 10 out of 10 repeated runs (several are timing-based). The guide's two required tests are "publish then consume delivers once" and "a handler that throws is redelivered up to the limit".

Mutation checks: 13 deliberate bugs in the adapter, each reverted:

- no FIFO group blocking
- dead-lettering one receive late, or never
- deduplication ignored, or its window never expiring
- no visibility timeout
- a stale receipt accepted
- a throwing handler acked
- FIFO sends without a group ID allowed
- the schema not checked
- attributes dropped
- concurrency ignored
- a stopping consumer still receiving

The first run missed the last one. The obvious test, publishing after `stop()` resolved, passes even with the bug, because a stopped consumer is already removed from the list. The bug only matters _during_ `stop()`, while handlers are still in flight. The contract now includes a test that publishes in that window, and it catches the bug.

Surprise: with dead-lettering removed, a handler that always throws is redelivered in a tight microtask loop. That starves the event loop, so even Vitest's own timeout never fires. The first mutation runner hung for hours, because on Windows `subprocess.run(..., timeout=)` with `shell=True` kills only the shell, not Node. The runner now kills the whole tree (`taskkill /T /F`) and counts a hang as caught. In the real adapter, dead-lettering ends that loop after `maxReceiveCount` deliveries. `retryDelayMs` can also space retries out.

**2.2 Document upload (2026-11-10).** An operator uploads a document straight to S3 through a presigned URL. The API never handles the bytes.

- Flow:
  1. `POST /api/workspaces/:id/documents` with `{ title, contentType, sizeBytes }` creates a `pending` document and returns a presigned `PUT` (5-minute expiry).
  2. The browser `PUT`s the file to S3.
  3. `POST /api/workspaces/:id/documents/:docId/confirm` checks that the object exists with the declared size and type, moves the document `pending` → `uploaded`, and enqueues an indexing job (`jobId` `index:<docId>`) on the in-process queue from 2.1. Nothing consumes it until 2.5.
- New packages:
  - `packages/storage`: the `ObjectStorage` interface and its S3 adapter, plus `@chatlium/storage/testing` with a throwaway Floci.
  - `packages/contracts`: the request schema, the limits, the S3 key layout and the indexing-job schema. The web app, the database package and (from 2.5) the worker share them.
- Limits:
  - At most 10 MiB per document. The guide's sources are policy and help documents, and 10 MiB of text is far more than one of those needs. Bigger files would also make the 2.5 worker's extraction and embedding cost unbounded per job.
  - Allowed types: plain text, Markdown, PDF and JSON.
  - The create request itself is capped at 2 KiB. The cap is checked against the declared `Content-Length`, and also while reading the stream, which stops at the limit.
- The S3 key is always `workspaces/<workspaceId>/documents/<documentId>`, derived on the server. The client never supplies it, and a `strictObject` schema refuses an `s3Key` field outright. The key is unique in the database.
- Content type and exact length are part of the SigV4 signature (`signableHeaders`), so S3 itself refuses a `PUT` with a different type or size. Confirm checks both again, in case an object reaches the key some other way.
- Writes need the operator role plus the amendments §2 CSRF check: a same-origin `Origin` and the session's synchronizer token in `x-csrf-token`, compared in constant time. A failure is the same plain 403 as any other authorization failure. A document of another workspace, a missing one and a malformed ID all give one identical 404.
- A second confirm re-sends the same job (same `jobId`), so a lost enqueue can be recovered. The status update only applies to a `pending` document, so two concurrent confirms cannot both win and a `ready` document never moves back.
- Known gap until 3.3: the status change commits before the publish, so a crash between them leaves an `uploaded` document with no job until someone confirms again. The outbox in Phase 3 closes this.
- `pnpm --filter @chatlium/dev-tools s3:setup` creates the local bucket. It is idempotent and refuses non-local endpoints. It blocks public access, enables versioning, and sets CORS to allow only a `PUT` with `content-type` from `APP_BASE_URL`.

Done-when evidence: `web:upload-check` passes against the dev server, Floci and the seeded database. It signs in, creates a document, passes the CORS preflight (another origin gets 403), uploads 89 bytes, confirms with 202, and sees the document listed as `uploaded`. A direct Postgres query agrees (`uploaded|text/markdown|89`). Along the way the check also confirms the refusals: confirm before the upload gives 409, a `PUT` with a different type gives 403, and a wrong CSRF token gives 403. Integration tests: 27 web (Postgres and Floci containers), 5 database lifecycle, and 6 storage (tampered size, type and key refused, expired URL refused).

Mutation checks: 25 deliberate bugs, each reverted. 24 are caught. They cover every confirm check, CSRF origin, token and length guard, the role, the pending-only update, enqueue on the wrong status, the key layout, the size limit, and unknown keys. The one survivor is equivalent: dropping the explicit `workspace_id` filter in `findDocument` changes nothing, because RLS already hides other tenants' rows. The filter stays as the decision record's defense in depth.

Two first-run misses taught something:

- **The body limit was only tested once.** The one 413 test was satisfied by either the declared-length check or the stream check, so removing either went unnoticed. There is now one test per check. The stream test uses an endless body, so it only finishes if reading stops at the limit.
- **A presigning option did nothing.** `unhoistableHeaders: content-type, content-length` was a no-op, because the SDK only hoists `x-amz-*` headers into the query string. I removed it. The mutant that matters, dropping `signableHeaders`, is caught.

Surprises:

- **Floci doesn't verify signatures by default.** Floci 2.4 accepts any presigned URL, tampered or expired, unless `FLOCI_AUTH_VALIDATE_SIGNATURES=true` is set. Without it, every "S3 refuses a changed upload" test would have passed against the bug. It is now set in `docker-compose.yml` and in the test container. Cognito still works with it on.
- **An UPDATE backfill hit FORCE RLS.** Migration `0003` first backfilled the new `content_type` and `size_bytes` columns with an `UPDATE`. That changed 0 rows, because migrations run as `chatlium_owner` and FORCE RLS hides every row from the owner when no workspace is set. Now each column is added `NOT NULL` with a `DEFAULT`, which DDL applies to every row regardless of RLS, and the default is dropped right after. A migration test checks that no default is left behind. Lesson: data migrations under FORCE RLS need a workspace context or DDL, never a plain owner `UPDATE`.

**2.3 Text extraction (2026-11-10).** New package `packages/knowledge`. `extractText(bytes, declaredType)` turns a stored document into plain text, or into a failure code. `extractUploadedDocument` is the indexing worker's first stage: it reads an `uploaded` document's object and, when extraction fails, marks the document `failed` with that code. The worker itself arrives in 2.5.

- Text, Markdown and JSON:
  - Decoded as UTF-8 with `fatal: true`, so invalid bytes are rejected, not replaced.
  - Null bytes and a byte-order mark are stripped, and line endings become `\n`.
  - JSON must also parse.
- The declared type is checked against the bytes. A PDF must start with `%PDF-`, and a text type must not, so neither can be passed off as the other.
- PDF: only the text layer is read, page by page, with a blank line between pages. The page start offsets are kept for citations later.
  - Fails with `no_text_layer` when the pages average fewer than 10 visible characters. A scan often still carries a page number, so "zero characters" would be too strict.
  - At most 500 pages. Password-protected files give `encrypted_pdf`; anything pdf.js can't parse gives `unreadable_pdf`.
- Failure codes live in `@chatlium/contracts` (`DOCUMENT_FAILURE_REASONS`, 10 codes). They are stored in the new `documents.failure_reason` column (migration `0004`), never as an error message or document content. A check constraint allows only those codes, and only on a `failed` document. The list is copied into the constraint, so adding a code needs a migration.
- `markDocumentFailed` acts for the workspace without a user (ADR 0003), and only moves `uploaded` → `failed`. A redelivered job can't overwrite an earlier outcome, and reports `skipped`.
- The stored object's size is checked with a `HEAD` before downloading, so an oversized object is never read into memory.

Library choice, verified 2026-11-10: **`pdfjs-dist` 6.5.438** (Mozilla's pdf.js, released 2026-11-01).

- `pdf-parse` was rejected: its last release was in 2025, and it pins pdf.js 5.4 plus a native canvas.
- `unpdf` was rejected: it bundles an older pdf.js (6.4).
- pdf.js 6 no longer has `isEvalSupported` (the CVE-2024-4367 setting). Font loading, system fonts, XFA and the offscreen canvas are all turned off.
- Its optional native `@napi-rs/canvas` is only used for rendering. `ignoredOptionalDependencies` keeps it out of the install.

Done-when evidence:

- The guide's five tests pass, as part of 20 unit tests: text, Markdown, a PDF with a text layer, a PDF without one (`no_text_layer`), and text declared as a PDF (`type_mismatch`).
- Test PDFs are built in memory by a small generator, with no binary fixtures. That includes a password-protected one (a Standard security handler whose check values match no password).
- 14 integration tests against real Postgres (as `chatlium_app`, RLS on) and Floci show that each failure sets `status = failed` with its reason: type mismatch both ways, no text layer, invalid UTF-8, invalid JSON, unsupported stored type, missing object, and too large without a download.
- 6 new database tests cover the worker helpers and the constraint.

Mutation checks: 28 deliberate bugs, each reverted. The first run caught 25. The three misses were real gaps in the tests:

- **Text-layer threshold on the document total instead of per page.** Every scan test had too little text in total to tell the two apart. A new test has three pages with a 5-character footer each: 15 characters in total, but 5 a page.
- **Line breaks dropped inside a page.** The PDF test used `toContain` per line, which a run-on page also satisfies. It now asserts the exact page text.
- **A lost race reported as `failed`.** Nothing tested another delivery winning between the read and the update. A new test makes the storage stub fail the document mid-check, and expects `skipped` with the first reason kept.

After those tests, all 28 are caught.

**2.4 Chunking (2026-11-10).** `chunkText(text, contentType)` in `packages/knowledge/src/chunking` splits extracted text into chunks. It is deterministic and has no dependencies. Each chunk records:

- `start` and `end`: offsets into the extracted text, with `text === source.slice(start, end)`, so a citation can point back to the source;
- `text`: the passage as written, which is the evidence shown;
- `headingPath`: the Markdown headings above it, outermost first;
- `embeddingText`: what 2.5 embeds and full-text indexes.

The parts:

- **Constants:** `CHUNK_TARGET_CHARS = 800` is the maximum length, about 150 to 200 English words. `CHUNK_OVERLAP_CHARS = 100` is the most a chunk repeats from the end of the previous one. A test pins both values.
- **Recursive splitter:** a range is only cut when it is longer than the target. It tries the coarsest boundary first: paragraph breaks, then line breaks, sentence ends, and spaces. As a last resort it uses fixed 100-character pieces, which never split a surrogate pair. I added line and word levels to the guide's paragraph → sentence → character order, so a list or a long sentence is cut at a natural place before falling back to raw characters.
- **Packing:** the pieces are packed greedily into chunks. Each next chunk starts with the trailing pieces of the previous one that fit in the overlap, and it always reaches past the previous chunk.
- **Markdown (amendments §12.5):**
  - Every ATX heading (`#` to `######`, at most three spaces in) starts a new chunk and sets the heading path. Headings inside fenced code blocks are ignored.
  - Overlap never crosses a heading, and a long section is split by the same recursive splitter, keeping its path on every piece.
  - `embeddingText` is `Refunds > Timelines`, a blank line, then the chunk's text. The evidence text has no prefix.
  - A heading with nothing under it, such as a parent heading right before its first child, gives no chunk of its own. Its title still appears in the child's path.
  - Setext headings (text underlined with `===`) are not recognised, and stay ordinary text.
- **Other types:** plain text, PDF and JSON use the recursive splitter alone. For PDFs, a chunk's page can be worked out from `start` and the extractor's `pageOffsets`.
- **Out of scope:** the other half of §12.5, `content_hash` reuse of vectors, belongs to 2.5. It needs the chunks table and the embedding calls.

Done-when evidence: 23 chunking tests pass.

- **The guide's four:**
  - empty input gives no chunks;
  - a short input gives one chunk, with its offsets;
  - a long input gives chunks within the limit, each overlapping the previous one by 1 to 100 characters;
  - the same input always gives the same chunks, with a committed snapshot of the offsets.
- **Amendments §12.5:** Markdown gives one chunk per section with its path, and the heading path appears only in `embeddingText`.
- **Every test also checks** that offsets match the text, that no chunk is over the limit or starts or ends with whitespace, that each chunk reaches past the previous one, and that every non-whitespace character is in some chunk.

Mutation checks: 23 deliberate bugs, each reverted. The first run caught 17. Four of the misses were real gaps in the tests:

- **Removing the paragraph level went unnoticed.** Line breaks also cut at blank lines, so the paragraph test still passed. A new test uses two paragraphs of ten short lines each: without the paragraph level, a chunk mixes the two.
- **Removing the progress guard went unnoticed.** Without it, a chunk can be nothing but the previous chunk's overlap. A new 700/90/750-character case hits that, and every test now checks that each chunk reaches past the previous one.
- **A `#` line indented four spaces (code, not a heading) wasn't tested.** The existing example had the `#` mid-line.
- **A `~~~` line closing a backtick fence wasn't tested.** One is now inside one.

After those tests, 21 of 23 are caught. The two left are equivalent:

- keeping a cut at the very end of a range only adds an empty piece, which is dropped;
- splitting a range of exactly 800 characters into finer pieces gets packed back into the same chunk.
