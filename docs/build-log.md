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
