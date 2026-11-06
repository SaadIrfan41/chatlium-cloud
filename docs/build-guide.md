# Chatlium: Build Guide

A phase-by-phase, step-by-step guide to build Chatlium from an empty repository to a deployed, tested, observable system. Follow the steps in order. Each step lists what to do, how you know it is done, and what usually goes wrong.

**Authoritative decisions:** `chatlium-greenfield-decisions.md`, `chatlium-greenfield-amendments.md`, `chatlium-usage-observability.md`. Where this guide and those files disagree, the decision files win. One update is required first (Step 0.1).

**How to use this guide**
- Work one step at a time. Do not start a step until the previous step's "Done when" is met.
- Commit at the end of each step, with a message that names the step (for example, `1.6 tenant migration and RLS`).
- Record each step's result in `docs/build-log.md`: date, what you did, what surprised you, and the time it took. The log becomes material for the final write-up.
- Items marked **Verify** must be checked against current documentation at the time you do them. Record the version you pinned.
- If a step's "Done when" fails after a reasonable attempt, stop and write down what failed. Do not work around it silently.

---

## Phase tracker

| Phase | Goal | Time limit | Actual | Status |
|---|---|---|---|---|
| 0 | Preparation | ___ | | |
| 1 | Foundation and tenant isolation | ___ | | |
| 2 | Vertical slice | ___ | | |
| 3 | Containers and local platform | ___ | | |
| 4 | AWS foundation | ___ | | |
| 5 | Kubernetes and delivery | ___ | | |
| 6 | Scaling and reliability | ___ | | |
| 7 | Observability and security hardening | ___ | | |
| 8 | Simple workflow editor | ___ | | |
| 9 | Evidence and write-up | ___ | | |

Set each time limit from your weekly hours (see Phase 0, Step 0.3). If a phase runs over, reduce its scope and record the overrun. Do not extend the limit silently.

---

## Ways of working

**Repository conventions**
- Trunk-based development: short-lived branches, merged to `main` through pull requests.
- Branch protection on `main`: required CI checks, one approval (you can self-approve if you're alone, but keep the check).
- Conventional commit messages (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Architecture decisions go in `docs/adr/` as numbered records. Write one when you make a decision that is hard to reverse.

**Definition of done for any step**
1. The code or configuration is committed.
2. The step's "Done when" check passes, and you can show it (a test run, a screenshot, a command output).
3. CI is green.
4. The build log has an entry.

**Stop-and-check points**
Phases end with a checkpoint. At a checkpoint, do not begin the next phase until every item in its exit checklist is checked.

---

## Phase 0: Preparation

**Goal:** Tools, accounts, budget guardrails, and the repository exist, and the decisions are recorded correctly.

### Step 0.1: Update the decision record for Cognito

The decision record still says Better Auth. Replace the authentication rows with:

- Authentication: Amazon Cognito user pool, OIDC authorization code flow with PKCE, validated server-side.
- Authorization: workspace membership and roles, checked in application code, plus row-level security.
- Session: server-side sealed `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No tokens in browser storage.

Update the amendments' CSRF section to match.

**Done when:** the decision record and amendments contain no mention of Better Auth as the active choice, and both commit to Cognito.

### Step 0.2: Install tooling

Install and record the version of each:

| Tool | Purpose | Notes |
|---|---|---|
| Git | Version control | |
| Node.js current LTS | Runtime | Use a version manager (fnm or nvm) |
| pnpm | Package manager | Enable through Corepack |
| Docker Desktop or Docker Engine | Containers, Testcontainers | Must be running for integration tests |
| AWS CLI v2 | AWS access | Configure a named profile for the test account only |
| Terraform | Infrastructure | **Verify** version 1.10 or later |
| kubectl | Kubernetes access | Phase 5 onward |
| Helm | Kubernetes packages | **Verify** Helm 4 compatibility with your tools |
| k6 | Load testing | Phase 6 onward |
| Floci | Local AWS emulation | Follow its setup docs |

**Done when:** every tool prints a version, and `docker run hello-world` succeeds.

**Watch out:** Testcontainers needs a working Docker daemon. If integration tests hang later, check Docker first.

### Step 0.3: Set the budget and time commitments

Fill in before anything else:
- Weekly hours available: ___
- Total duration: ___
- Monthly AWS ceiling: ___ (the working target is $50–100)

**Done when:** these numbers are written at the top of `docs/build-log.md`, and the phase time limits in the tracker are filled in.

### Step 0.4: Create accounts and budget alarms

1. Create a **separate AWS account** for this project. Do not use your personal or work account.
2. Enable MFA on the root user and create an administrative IAM user or identity-center user for daily work. Stop using root.
3. Create an **AWS Budgets** alert at 50%, 80%, and 100% of your ceiling. Use an email address you check.
4. Create a Gemini API key in Google AI Studio. Store it in a password manager. Do not commit it.
5. Create a GitHub repository, `chatlium`, private.

**Done when:** the budget alerts show as active, you can sign in as the non-root IAM user, and the repository exists.

**Watch out:** Budget alerts are notifications, not caps. They tell you spending is happening. Check the Cost Explorer after each phase.

### Step 0.5: Create the repository skeleton

```
chatlium/
├── docs/
│   ├── adr/
│   │   └── 0001-stack.md
│   ├── build-log.md
│   └── decisions/          (copy the three decision files here)
├── .github/
│   └── pull_request_template.md
├── .gitignore
├── .nvmrc
├── .editorconfig
└── README.md
```

Write `0001-stack.md` as a short ADR that points to the decision files. Write `build-log.md` with the numbers from Step 0.3.

**Done when:** the repository is pushed to `main`, `main` is protected, and the README states the project goal in two sentences.

### Phase 0 exit checklist
- [ ] Decision record updated to Cognito
- [ ] All tools installed and versions recorded
- [ ] Separate AWS account, MFA on root, non-root user in use
- [ ] Budget alerts active
- [ ] Gemini key stored outside the repository
- [ ] Repository created with ADR and build log

---

## Phase 1: Foundation and tenant isolation

**Goal:** A monorepo with validated configuration, a database with row-level security enforced from the first migration, isolation tests that pass, Cognito sign-in, membership checks, and CI.

**Why this order:** tenant isolation is the highest-risk property of the system. Build and test it before any feature depends on it.

### Step 1.1: Initialize the monorepo

1. `pnpm init` at the root. Set `"private": true`.
2. Create `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```
3. Install Turborepo and create `turbo.json` with tasks `build`, `lint`, `typecheck`, `test`.
4. Create `packages/tsconfig` with a base `tsconfig.json` using `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.
5. Add ESLint and Prettier at the root. Configure them once.
6. Pin the Node version in `.nvmrc`. Add `"engines"` to the root `package.json`.

**Done when:** `pnpm install`, `pnpm lint`, and `pnpm typecheck` run on an empty workspace without errors.

**Watch out:** Create packages only when a step needs them. Do not create the full architecture of empty packages.

### Step 1.2: Configuration package

Create `packages/config`:
- A Zod schema describing every environment variable the system uses (database URL, Cognito pool ID and client ID, AWS region, Gemini key reference, and so on).
- `loadConfig()` parses `process.env`. On failure, it throws an error that lists every missing or invalid variable.
- Secrets are never printed in errors.

Add unit tests:
- A complete environment parses successfully.
- A missing required variable fails with a message naming that variable.
- A malformed value fails.

**Done when:** the three tests pass, and a deliberately broken environment fails at startup with a readable message.

### Step 1.3: Structured logger

Create `packages/observability` with a Pino logger:
- JSON output with timestamp, level, service name.
- A `redact` configuration for `authorization`, `cookie`, `password`, `token`, and any field whose name matches `*key*`.
- A helper to create child loggers with `workspace_id`, `request_id`.

Add a test that logs a value containing a fake secret and checks the output does not contain it.

**Done when:** the redaction test passes.

### Step 1.4: Local infrastructure

Create `docker-compose.yml` with:
- PostgreSQL with pgvector. Use the official pgvector image, tagged for a supported PostgreSQL major version. **Verify** the tag.
- Redis.

Start it and connect with `psql`. Run `CREATE EXTENSION vector;` to confirm pgvector is available.

**Done when:** `docker compose up -d` starts both services, and the vector extension creates successfully.

### Step 1.5: Database package and roles

Create `packages/db` with Drizzle ORM and drizzle-kit.

1. Create two database roles, managed by the migration:
   - `chatlium_owner`: owns the schema and runs migrations. Not used by the application.
   - `chatlium_app`: `LOGIN`, not a superuser, no `BYPASSRLS`. Used by the application.
2. Grant `chatlium_app` only the privileges it needs: `SELECT, INSERT, UPDATE, DELETE` on application tables, `USAGE` on the sequences it uses.
3. Confirm: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'chatlium_app';` returns `false, false`.

**Done when:** the confirmation query returns `false, false`, and the application role can connect.

**Watch out:** If the application connects as a superuser, RLS is silently bypassed. Test it: after this step, an isolation test in Step 1.8 must fail if you connect as the superuser. Keep that test as a guard.

### Step 1.6: Phase 1 schema and the RLS migration

Create these tables in the first migration:

| Table | Key columns | Tenant-scoped |
|---|---|---|
| `users` | `id` (UUID), `cognito_sub` (unique), `email`, `created_at` | No |
| `workspaces` | `id`, `name`, `created_at` | No (the workspace is the tenant) |
| `memberships` | `id`, `workspace_id`, `user_id`, `role` (`owner`, `admin`, `operator`), unique on (`workspace_id`, `user_id`) | Yes, but read via the membership policy below |
| `documents` | `id`, `workspace_id`, `title`, `status`, `s3_key`, `embedding_model`, `embedding_dims`, `created_at` | Yes |
| `conversations` | `id`, `workspace_id`, `status` (`active`, `escalated`), `created_at` | Yes |

Enable RLS on `memberships`, `documents`, and `conversations`. Use `FORCE ROW LEVEL SECURITY` on each.

**Tenant policy** (for `documents` and `conversations`):

```sql
CREATE POLICY tenant_isolation ON documents
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
```

**Membership policy** (for `memberships`). It allows a user to read only their own membership rows, keyed on the authenticated user:

```sql
CREATE POLICY own_memberships ON memberships
  FOR SELECT
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY membership_write ON memberships
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
```

Use `nullif(..., '')` so an unset setting returns null and the policy returns no rows. Without it, the cast fails with an error instead of failing closed.

**Done when:** the migration applies to an empty database, `\d+ documents` shows RLS enabled and forced, and running the migration twice is a no-op.

**Watch out:** Migrations run as `chatlium_owner`. Table owners bypass RLS unless `FORCE` is set, which is why `FORCE` matters here.

### Step 1.7: Tenant context helpers

In `packages/db`, create two functions:

```ts
// Runs fn inside a transaction with the workspace context set.
withWorkspace(db, workspaceId, fn)

// Runs fn inside a transaction with only the user context set.
// Used for membership lookup before a workspace is chosen.
withUser(db, userId, fn)
```

Inside each transaction, set the context with `set_config`, not `SET LOCAL` string interpolation:

```sql
SELECT set_config('app.workspace_id', $1, true);
```

The third argument `true` makes the setting transaction-local, so it cannot leak to another request on a pooled connection.

**Done when:** a unit test shows that after `withWorkspace(A)` completes, a new transaction on the same connection has no `app.workspace_id` set.

**Watch out:** `SET LOCAL` does not accept bind parameters. Using string interpolation for workspace IDs creates an SQL injection path. Use `set_config` with a parameter.

### Step 1.8: Isolation tests (write before the features)

Create `packages/db/test/isolation.test.ts`. Use Vitest with Testcontainers to start a real PostgreSQL, run the migrations, and seed data as the owner role. Then connect as `chatlium_app` for each assertion.

Required tests:

1. Workspace A's user cannot read workspace B's documents.
2. Workspace A's user cannot read workspace B's conversations.
3. Inserting a document with workspace B's ID while in workspace A's context fails (WITH CHECK).
4. A transaction with no workspace context reads zero rows from tenant tables.
5. A user cannot read another user's membership rows through `withUser`.
6. A user with a membership in workspace A, but none in B, reads zero rows from B when acting through `withWorkspace(B)`.
7. The application role is not a superuser and does not bypass RLS. (This test fails if the wrong role is used.)

**Done when:** all seven tests pass in a local run and in CI.

**Watch out:** A test that passes for the wrong reason proves nothing. For each test, temporarily disable the policy it covers, confirm the test now fails, then restore the policy. Record this in the build log.

### Step 1.9: Cognito user pool (development)

**Verify** whether Floci supports the Cognito features you need. If it does not, use a development user pool in the test AWS account. Either way, the application code uses the same OIDC configuration.

In the development pool:
1. Create a user pool with email sign-in and a password policy.
2. Enable MFA as optional for now. Plan to require it for operator accounts in Phase 7.
3. Create an app client with:
   - Authorization code grant with PKCE.
   - No client secret for the public web flow, or a client secret held only on the server. Decide and record it in an ADR.
   - Allowed callback URL `http://localhost:3000/api/auth/callback`.
   - Access token lifetime of 15 minutes. Refresh token lifetime of 7 days (adjust later).
4. Create two test users.

**Done when:** you can complete the hosted sign-in flow for a test user and see the redirect with an authorization code.

**Watch out:** Callback URLs must match exactly, including the port and path. A mismatch is the most common cause of sign-in failure.

### Step 1.10: Web application skeleton and sign-in

Create `apps/web` with Next.js (App Router), TypeScript, and Tailwind.

Implement:
1. `GET /api/auth/login`: builds the Cognito authorize URL with a random `state`, a PKCE `code_verifier`, and a `nonce`. Stores them in a short-lived sealed cookie.
2. `GET /api/auth/callback`: checks `state`, exchanges the code for tokens on the server, verifies the ID token, and creates a session cookie. The session cookie is sealed (encrypted and signed) with a key from configuration, and is `HttpOnly`, `Secure` in production, and `SameSite=Lax`.
3. `POST /api/auth/logout`: clears the session cookie and calls Cognito's logout endpoint.

Use an OIDC client library, such as `openid-client`. **Verify** the current version and its API. Use a cookie-sealing library or implement sealing with authenticated encryption (AES-GCM) using a key from Secrets Manager in production and from local config in development.

**Done when:** a test user can sign in, the browser holds only the sealed `HttpOnly` cookie (check in devtools that no token appears in `localStorage` or `sessionStorage`), and signing out removes the cookie.

**Watch out:** Verify the ID token's `iss`, `aud` (or `client_id`), `exp`, `nonce`, and `token_use`. Skipping any one of these is a known class of vulnerability.

### Step 1.11: Token verification and session loading

Create `packages/auth`:
- `verifyIdToken(token)`: fetches Cognito's JWKS, verifies signature, `iss`, `aud`/`client_id`, `exp`, and `token_use`. Use `jose` (**Verify** the current version).
- `requireSession(request)`: reads the sealed session cookie, verifies it, and returns `{ userId, cognitoSub }`. The `userId` is the application's UUID from the `users` table, created on first sign-in.

Add tests with a locally generated JWKS for valid, expired, wrong-audience, and wrong-issuer tokens.

**Done when:** the four invalid-token cases are rejected and the valid case is accepted, in tests.

### Step 1.12: Membership and role checks

Create `requireWorkspaceRole(request, workspaceId, minimumRole)` in `packages/auth`:

1. Calls `requireSession`.
2. Calls `withUser(db, userId, ...)` and reads the user's membership for the workspace.
3. If there is no membership, or the role is below the minimum, returns 403 with no detail about whether the workspace exists.
4. Otherwise returns the membership, and the caller then uses `withWorkspace(db, workspaceId, ...)` for its queries.

Add API routes that exercise it:
- `GET /api/workspaces`: lists the user's workspaces (using the membership policy).
- `GET /api/workspaces/:id/documents`: lists documents, requires `operator` role or higher.

Add integration tests:
- A member gets 200.
- A non-member gets 403, and the response body is identical to the response for a workspace that does not exist.
- A member with the wrong role gets 403.

**Done when:** these tests pass, and a manual check shows a signed-in user only sees their own workspaces.

**Watch out:** Returning different responses for "no such workspace" and "not a member" leaks which workspace IDs exist. Return the same response for both.

### Step 1.13: Continuous integration

Create `.github/workflows/ci.yml`:
- Triggers on pull requests and pushes to `main`.
- Sets up Node from `.nvmrc`, enables pnpm, installs with `--frozen-lockfile`.
- Runs `lint`, `typecheck`, `test` (unit), and `test:integration` (Testcontainers).
- Caches the pnpm store.

Add Renovate with grouped weekly updates. Commit the lockfile.

Make the CI checks required on `main`.

**Done when:** a deliberately failing test blocks a pull request from merging, and removing the failure makes it pass.

### Phase 1 exit checklist
- [ ] Monorepo builds, lints, and type-checks
- [ ] Configuration fails fast with clear messages
- [ ] Logger redacts secrets (tested)
- [ ] Migration enables and forces RLS on tenant tables
- [ ] Application role is not a superuser and does not bypass RLS
- [ ] All seven isolation tests pass, and each was verified to fail when its policy is disabled
- [ ] Sign-in works, and tokens never reach browser storage
- [ ] Membership checks return identical responses for missing and forbidden workspaces
- [ ] CI is required and green

---

## Phase 2: Vertical slice

**Goal:** One end-to-end path works, from a document upload to a grounded streamed answer in a widget, with escalation to an operator inbox and visible usage. Use simple local implementations where the production version comes later (in-process queue, local Redis rate limit). The slice must be correct, not complete.

### Step 2.1: Queue interface and local adapter

Create `packages/queue`:
- `MessageQueue` interface: `publish(message, options)`, `consume(handler, options)`, `ack`, `nack`.
- An in-process adapter, used for unit tests in every phase and as the development queue in Phase 2 only.

Write a test for each: publish then consume delivers once; a handler that throws leads to redelivery up to the limit.

**Done when:** the tests pass. From Phase 3, development and integration tests use the SQS adapter against Floci. The in-process adapter stays for unit tests only.

### Step 2.2: Document upload with presigned URLs

Add a storage interface and an S3 adapter in `packages/storage`. Use Floci or a local S3-compatible service for development.

Routes:
1. `POST /api/workspaces/:id/documents`: requires `operator`. Validates title and declared content type and size. Inserts a document with status `pending`. Returns a presigned PUT URL with a short expiry.
2. `POST /api/workspaces/:id/documents/:docId/confirm`: checks the object exists and its size is within limit. Sets status to `uploaded`. Enqueues an indexing job.

Limits to enforce: maximum file size (choose a value and record it), and allowed types (`text/plain`, `text/markdown`, `application/pdf`, `application/json`).

**Done when:** you can upload a file through the presigned URL and see it marked `uploaded` in the database.

**Watch out:** The declared content type is a claim, not a fact. You verify the actual content in Step 2.3.

### Step 2.3: Text extraction

Create `packages/knowledge/extractors`:
- `text/plain`, `text/markdown`, `application/json`: decode as UTF-8. Reject invalid byte sequences. Strip null bytes.
- `application/pdf`: extract the text layer with a maintained PDF library. **Verify** the library's current status and its handling of your test PDFs.
- Check the first bytes of each file against its declared type. A PDF must start with `%PDF`. Reject mismatches.

Tests: a text file, a markdown file, a PDF with a real text layer, a PDF with no text layer (should fail with a clear status), a file declared as PDF that is really text (should be rejected).

**Done when:** all five tests pass, and a failed extraction sets the document status to `failed` with a reason.

### Step 2.4: Chunking

Create a deterministic recursive character splitter in `packages/knowledge/chunking`:
- Target size around 800 characters, overlap around 100. Choose the values, record them as constants, and do not change them without a test update.
- Split on paragraph breaks first, then sentences, then characters.
- Each chunk records its character offsets in the source.

Tests: empty input produces no chunks; a short input produces one chunk; a long input produces chunks within the size limit with the expected overlap; the same input always produces the same chunks.

**Done when:** the tests pass.

### Step 2.5: Embeddings and the indexing worker

Create `packages/ai` with:
- `LLMProvider` interface (`generate`, `stream`, `embed`).
- A Gemini adapter using the Vercel AI SDK and the Google provider. **Verify** the current package names and the embedding model's output dimensionality option. This guide assumes `gemini-embedding-001` at 768 dimensions. Record the model and dimensions in one constants module.

Create the indexing job handler in `apps/indexing-worker` (in-process for now):
1. Load the document under `withWorkspace`.
2. Extract, chunk, and embed in batches.
3. Insert chunks with their vectors in one transaction.
4. Set the document to `ready`, and record `embedding_model` and `embedding_dims`.
5. Write one `embedding_calls` row per batch with `purpose = indexing` and `document_id` set.
6. On failure, set the document to `failed` with a sanitized reason.

Add the `document_chunks` table with a `vector(768)` column and an HNSW index for cosine distance. Add `embedding_calls` as well.

**Done when:** uploading a markdown file results in a `ready` document, chunk rows with vectors, and one embedding usage row.

**Watch out:** Do not put document text into logs or traces. Log counts and IDs only.

### Step 2.6: Vector search with tenant scope

Create `packages/knowledge/retrieval`:
- `search(workspaceId, queryText, { topK, minScore })`: embeds the query (writes an `embedding_calls` row with `purpose = query`), then runs a cosine similarity query inside `withWorkspace`, filtered to `ready` documents.
- Filter by the document's recorded embedding model. A query is refused if the deployment's model does not match.
- Return chunk text, document ID, and similarity score.

Tests:
- Relevant content ranks first for a matching query.
- A query from workspace A never returns workspace B's chunks, even when B's chunks would score higher.
- A document with a different recorded embedding model is excluded.

**Done when:** the three tests pass.

**Watch out:** Filter by tenant in the query itself, not after retrieving the top results. Post-filtering can return fewer results or leak through scoring side effects.

### Step 2.7: Widget identity and public configuration

Create the `widgets` table: `id` (public, non-guessable), `workspace_id`, `allowed_origins` (array), `created_at`, `disabled_at`.

Routes:
- `POST /api/workspaces/:id/widgets`: requires `admin`. Creates a widget.
- `POST /api/widget/session`: takes the widget ID and the browser's `Origin`. Checks the widget exists, is enabled, and the origin is allowlisted. Issues a short-lived signed token (JWT, 15 minutes) with claims `widget_id`, `workspace_id`, `origin`, and a visitor reference. Sign with a key from configuration.

Tests:
- A valid widget and origin get a token.
- A non-allowlisted origin is refused.
- A disabled widget is refused.
- A widget ID with no matching record is refused, with the same response as a disabled one.

**Done when:** the four tests pass.

**Watch out:** The widget ID is an identifier, not a secret. The token and the origin check are the controls. Do not treat the ID as proof of anything.

### Step 2.8: Message intake

Route: `POST /api/widget/messages`.

Checks, in order, and each one tested:
1. Token is present, valid, unexpired, and scoped to this widget.
2. `Origin` matches the token's origin.
3. Body size is within limit (check the size before parsing).
4. Message text validates (non-empty, maximum length).
5. Rate limit per token and per IP (Redis in development, using a sliding window).

Then, in one transaction:
1. Create the conversation if this visitor has none. Use the token's visitor reference to find an existing one.
2. Insert the visitor's message.
3. Enqueue a chat job.

Return `202` with the conversation ID and message ID.

Tests: each of the five checks refuses correctly, and a valid request creates exactly one message and one job.

**Done when:** these tests pass, and a valid request returns `202`.

**Watch out:** Enqueue inside the same transaction is not yet safe in Phase 2. Phase 3 introduces the outbox, which fixes this. Note this in the build log so you remember to revisit it.

### Step 2.9: Workflow executor v0 (fixed default graph)

Create `packages/workflow` with:
- A fixed default graph in code: `Knowledge → LLM → Condition → Action`.
- An executor that runs nodes in order, passes typed outputs between them, and records each step in `execution_steps`.
- An `executions` row pinned to a workflow version (the default graph is version 1).

Node contracts (define these as typed interfaces):
- Knowledge: input query text; output chunks and top score.
- LLM: input query, chunks, history; output answer text, and usage.
- Condition: input top score and the visitor's escalation request; output `answer` or `escalate`.
- Action: input decision; performs `send_message` or `escalate_human`.

Create the `execution_steps` and `workflow_versions` tables as part of this step's migration, with RLS.

**Done when:** a fixed input produces a recorded execution with four steps and the expected decision.

### Step 2.10: Chat worker and streamed answers

Create `apps/chat-worker` (in-process queue for now). For each chat job:
1. Claim the job in `processed_messages` (or, if already claimed by another attempt, stop). Phase 3 formalizes the claim lease. Record the simple version now.
2. Load the conversation under `withWorkspace`.
3. Execute the default graph.
4. In the LLM node, call `streamText` with telemetry settings `recordInputs: false` and `recordOutputs: false`. **Verify** the current option names in the Vercel AI SDK docs.
5. Stream token deltas to the visitor's realtime channel. In this phase, it is acceptable to publish through the Centrifugo server API (step 2.11 adds it).
6. On completion, write the assistant message and the `llm_calls` usage row (status, tokens if reported, estimated cost, duration, time to first token).
7. Update the execution to `completed` and roll up totals in the same transaction.

**Done when:** a message produces a streamed, grounded answer, and the execution and usage rows exist.

**Watch out:** Write the final message only once, at completion. If the worker crashes mid-stream, the visitor may see a partial answer, but the database must not record a second full answer on retry.

### Step 2.11: Local Centrifugo and realtime authorization

Add Centrifugo to `docker-compose.yml` with a configuration file. Pin its version after **verifying** the current release.

Authorization model (from the amendments):
- Visitor channel: one per conversation. The Next.js API issues a subscription token only after verifying the widget token and the conversation's ownership.
- Operator channel: one per workspace. Issued only after session and membership-with-role checks.
- Browsers never receive a publish credential. The server publishes using its API key.

Tests:
- Visitor token for conversation A cannot subscribe to conversation B.
- Member of workspace A cannot subscribe to workspace B's operator channel.
- Expired subscription token is refused.

**Done when:** the three tests pass, and a manual subscription from the browser receives the streamed tokens for its own conversation only.

### Step 2.12: Condition and escalation

Escalation rules for the slice:
- Escalate if the top similarity score is below a threshold, or the visitor asks for a person.
- The threshold is a named constant. Set it by testing on your sample documents, and record the value and the reason in an ADR. Do not guess.

Action node `escalate_human` is the **only** code that changes conversation status:

```sql
UPDATE conversations
SET status = 'escalated'
WHERE id = $1 AND status <> 'escalated'
RETURNING id;
```

If nothing is returned, the escalation already happened, so do nothing. Then publish an inbox event to the operator channel.

Tests:
- Low score escalates.
- High score answers.
- Visitor asking for a person escalates.
- Two escalation signals produce one status change and one inbox event.

**Done when:** the four tests pass.

### Step 2.13: Widget frontend (Vite)

Create `apps/widget` with React and Vite:
- Build two artifacts: a small stable loader `widget.js` and a versioned bundle `widget.<version>.js` with its CSS.
- The loader reads the widget ID from its script tag's `data-widget-id` attribute, and loads the versioned bundle.
- Mount the UI inside a Shadow DOM root, so host site styles cannot leak in and the widget's styles cannot leak out.
- UI: open/close button, message list, input, streamed assistant text, escalation notice.

Create a test host page (`apps/widget/test-host/index.html`) with unrelated styles and content, to prove isolation.

**Done when:** the widget loads on the test host page, sends a message, displays a streamed answer, and displays the escalation notice when escalated.

**Watch out:** Do not hard-code the API base URL. Read it from the loader's configuration so the same bundle works in development and production.

### Step 2.14: Minimal operator dashboard

Build these pages in `apps/web`:
- Workspace home with the workspace name and navigation.
- Documents list with status, and an upload form.
- Conversations list with status badge (escalated highlighted).
- Conversation detail: messages, and totals for tokens and estimated cost.

Use TanStack Query for data fetching. Keep state local to components unless it is shared.

**Done when:** an operator can upload a document, see it become `ready`, see a conversation, and see an escalated conversation highlighted.

### Step 2.15: Usage v0

- Seed the `model_prices` table with the models you use and a `version` value.
- Each `llm_calls` and `embedding_calls` row records `usage_status` (`reported`, `estimated`, or `unknown`), and `cost_micros` only when computable.
- Conversation detail shows total tokens and estimated cost, labeled "estimated," with the price version.
- A timed-out or failed call records `usage_status = unknown` and does not record zero.

Tests:
- A failed call writes a row with `unknown`.
- Conversation totals equal the sum of its runs.
- Changing a price version does not change historical rows.

**Done when:** the three tests pass.

### Step 2.16: Slice acceptance test

Write one Playwright test that performs the full path:
1. Sign in as an operator.
2. Upload a markdown document with known content.
3. Wait for `ready`.
4. Open the widget test host page.
5. Ask a question the document answers. Assert a streamed answer appears, and that it mentions a fact from the document.
6. Ask a question the document does not answer. Assert the escalation notice appears.
7. Sign in as an operator and see the conversation in the inbox, highlighted as escalated.

Record a short screen capture of this run. Save it under `docs/evidence/`.

**Done when:** the test passes locally, and the recording exists.

### Phase 2 exit checklist
- [ ] Upload, extraction, chunking, embedding, and retrieval work and are tested
- [ ] Retrieval is tenant-scoped in the query, and cross-tenant retrieval is tested
- [ ] Widget tokens and origin checks are tested
- [ ] Message intake has five tested checks and creates one message and one job
- [ ] Streamed answers are grounded, and only one final answer is written
- [ ] Realtime authorization tests pass
- [ ] Escalation is single-owner and idempotent, and tested
- [ ] Widget isolates styles in a test host page
- [ ] Usage rows exist, with unknown usage recorded as unknown
- [ ] Acceptance test passes and is recorded
- [ ] Build log records the Phase 3 items: the outbox and the enqueue-in-transaction gap

---

## Phase 3: Containers and local platform

**Goal:** The system runs as separate containerized processes, using SQS (through Floci) and a transactional outbox. Failures are survivable, and the failure tests prove it.

### Step 3.1: Dockerfiles

For `web`, `chat-worker`, `indexing-worker`, `outbox-dispatcher`, and the widget:
- Multi-stage build: install and build in one stage, copy only production output into a minimal runtime stage. Use `pnpm deploy` to produce a pruned production directory.
- Run as a non-root user with a fixed numeric UID.
- Set `NODE_ENV=production`.
- Add a `HEALTHCHECK` or rely on the orchestrator's probes (the probes are added in Phase 5).
- Do not copy `.env` files or secrets into images.

**Done when:** each image builds, runs as non-root (`docker run --rm <image> id` shows a non-zero UID), and starts.

### Step 3.2: Process lifecycle

Every process:
- Exposes `/healthz` (process is alive) and `/readyz` (dependencies respond: database, queue, and Redis where used).
- Handles `SIGTERM`: stops accepting new work, finishes in-flight work with a timeout, closes connections, exits with code 0.
- Logs the shutdown sequence.

Test: start a worker with a long-running fake job, send `SIGTERM`, and confirm the job finishes before exit.

**Done when:** the shutdown test passes, and `/readyz` returns failure when the database is stopped.

### Step 3.3: Outbox table and dispatcher

Create `outbox_events`: `id`, `event_id` (unique), `workspace_id`, `topic` (`chat` or `indexing`), `payload` (JSON, validated against a contract in `packages/contracts`), `status` (`pending`, `published`), `attempts`, `created_at`, `published_at`.

Write every event that follows a database change in the same transaction as that change. Replace the Phase 2 direct enqueue.

The dispatcher:
1. Selects pending rows with `FOR UPDATE SKIP LOCKED`, in batches.
2. Publishes each to the queue with the `event_id` as the deduplication ID.
3. Marks the row `published` after a successful publish.
4. Backs off on failure, and stops retrying after a configured maximum.

**Watch out:** The dispatcher needs to read outbox rows across all workspaces. Do not give the application role that access. Create a separate dispatcher role that can read and update only `outbox_events`, and enforce this with grants and a test. Give the outbox table an RLS policy that the dispatcher role can satisfy explicitly, and document the choice in an ADR.

**Done when:** a test writes an event in a transaction, rolls the transaction back, and confirms nothing is published. A second test commits and confirms exactly one publish.

### Step 3.4: Switch to SQS through Floci

Create queues in Floci:
- `chat.fifo` (FIFO, content-based deduplication off, we pass `event_id` explicitly), with a dead-letter queue `chat-dlq.fifo`.
- `indexing` (Standard) with a dead-letter queue `indexing-dlq`.
- Redrive policy with max receive count of 5.

Write the SQS adapter for `MessageQueue`:
- Chat messages: `MessageGroupId = conversation_id`, `MessageDeduplicationId = event_id`.
- Indexing messages: no group ID.

**Verify** Floci's FIFO behavior with the contract test suite in step 3.5 before relying on it.

**Done when:** the adapter publishes to and consumes from both queues in Floci.

### Step 3.5: Queue contract tests

Run this suite against Floci now, and against real SQS in the test AWS account before Phase 5 (record the result):

1. Ordering within a group: messages in group A arrive in send order.
2. Concurrency across groups: two consumers process groups A and B at the same time.
3. Deduplication: sending the same `event_id` twice within the deduplication window yields one delivery.
4. Visibility and redelivery: an unacknowledged message reappears after the visibility timeout.
5. DLQ movement: a message that fails the maximum number of times lands in the DLQ.
6. Crash and recovery: a consumer killed mid-message leads to redelivery, and the idempotency check prevents a second side effect.

**Done when:** all six pass against Floci, and the results are recorded. Record the real-SQS run as a pending item for Phase 5 if it has not run yet.

### Step 3.6: Idempotent consumers with claim leases

The Phase 2 version of `processed_messages` is not enough. Replace it with a claim model:

- `processed_messages`: `job_id` (unique), `status` (`claimed`, `completed`, `failed`), `claimed_by`, `lease_expires_at`, `attempts`.
- To start a job: insert, or update if the existing row is `claimed` with an expired lease. This is one atomic statement.
- Side effects (the assistant message, the usage rows, the execution status) are written in the same transaction that sets the status to `completed`.
- If a worker dies holding a lease, another worker can claim the job after expiry.

Tests:
- Two workers claim the same job; exactly one proceeds.
- A worker dies mid-job; after lease expiry, the job completes once.
- A completed job redelivered produces no new side effects.

**Done when:** the three tests pass.

**Watch out:** A claim record alone does not make side effects safe. The side effects and the completion must commit together, or external calls must be designed to be repeatable. Note any external call that is not repeatable (for example, a future HTTP action) and handle it explicitly.

### Step 3.7: Usage keys for retries

Each provider request gets a stable key: `job_id` + `call_index`. A retry of the same logical call within a job uses the same `call_index` and increments `attempt`. The `llm_calls` table has a unique constraint on (`idempotency_key`, `attempt`).

Tests:
- A retried provider call writes a new attempt row, not a duplicate of the first attempt.
- A redelivered job that finds existing rows for its calls does not write new ones.

**Done when:** both tests pass.

### Step 3.8: Full local stack

Extend `docker-compose.yml` to run:
- `web`, `chat-worker`, `indexing-worker`, `outbox-dispatcher`, and `centrifugo` as containers.
- `postgres`, `redis`, and `floci` as dependencies, with health checks.
- Startup ordering through health conditions, not sleeps.
- Environment from a `.env.example` file, with no real secrets committed.

**Done when:** `docker compose up` starts the system, the acceptance test from Step 2.16 passes against it, and `docker compose down -v` leaves nothing behind.

### Step 3.9: Local failure tests

Run each and record the result in the build log:

1. Kill the chat worker container during a job, restart it, confirm the job completes exactly once.
2. Publish the same chat event twice, confirm one assistant message.
3. Force a job to fail repeatedly, confirm it moves to the DLQ, and confirm the DLQ has the message.
4. Stop the database, confirm `/readyz` fails on workers and web, then restart and confirm recovery.
5. Replay a DLQ message after fixing the cause, confirm it completes.

**Done when:** all five pass, and each result is recorded.

### Phase 3 exit checklist
- [ ] Five images build, run as non-root, and shut down gracefully
- [ ] Outbox writes are transactional, and the dispatcher role has minimal access
- [ ] SQS adapter passes the six contract tests on Floci
- [ ] Claim leases prevent duplicate side effects in tests
- [ ] Usage keys prevent duplicate usage rows on retry
- [ ] Full local stack runs with one command and passes the acceptance test
- [ ] Five local failure tests passed and recorded

---

## Phase 4: AWS foundation

**Goal:** Everything the system needs in AWS is created by Terraform, from an empty account, and can be destroyed cleanly. Demonstration cost is controlled.

### Step 4.1: Terraform state bootstrap

Create a bootstrap module (or a one-time setup) for:
- An S3 bucket for state: versioning on, default encryption (SSE-KMS), public access blocked, and a bucket policy that restricts access to the Terraform role.
- The Terraform backend configuration:

```hcl
terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "<your-state-bucket>"
    key          = "chatlium/terraform.tfstate"
    region       = "<region>"
    encrypt      = true
    use_lockfile = true
  }
}
```

Grant the Terraform role permission to create, read, and delete the `.tflock` object. Deletion is required to release a lock.

**Done when:** `terraform init` succeeds, and a plan takes and releases a lock (check the bucket for the lock object during a long plan).

**Watch out:** Losing the state bucket means losing track of your infrastructure. Keep versioning on and do not delete the bucket until you have destroyed everything it manages.

### Step 4.2: Network module

Create `infra/terraform/modules/network`:
- VPC with a /16 CIDR.
- Three availability zones, each with a public subnet, a private application subnet, and a private data subnet.
- Internet gateway, route tables, and a NAT gateway configuration controlled by a variable: `nat_mode = "single"` for the demonstration, `nat_mode = "per_az"` for the production design.
- VPC flow logs to CloudWatch Logs with retention set.
- VPC endpoints for S3 (gateway) and for SQS, KMS, Secrets Manager, ECR, and CloudWatch Logs (interface endpoints, evaluated against cost).

**Done when:** `terraform plan` shows the expected resources, and `apply` creates them. Record the hourly cost of the NAT and endpoints.

**Watch out:** Interface endpoints have a per-hour cost in every AZ. Measure the total before keeping them in the demonstration environment, and document the decision.

### Step 4.3: Data services

Create modules for:
- **RDS PostgreSQL** with pgvector: encryption on, subnet group in the data subnets, security group allowing only the application security group, automated backups with a retention period, Multi-AZ as a variable (off for demonstration, on for production design), deletion protection as a variable.
- **ElastiCache for Redis**: encryption at rest and in transit, subnet group in data subnets, security group restricted to the application.
- **S3 buckets**: documents bucket (versioning on, SSE-KMS, public access blocked, lifecycle rule for noncurrent versions) and widget assets bucket (versioning on, public access blocked, access only through CloudFront origin access control, added in Phase 5).
- **SQS**: `chat.fifo` with DLQ, `indexing` with DLQ, redrive policy, encryption.
- **KMS**: a customer-managed key for S3, RDS, SQS, and Secrets Manager, with a key policy that grants only the required roles.
- **Secrets Manager**: database credentials (generated by Secrets Manager, rotated), Centrifugo API key, session sealing key, Gemini key. Values are never in Terraform state in plaintext where you can avoid it. **Verify** how your chosen Secrets Manager resource handles values in state, and document the approach.

**Done when:** `terraform apply` creates all data services, and the application can connect to RDS and Redis from a test instance in the application subnet.

### Step 4.4: Identity and workload permissions

1. Move the Cognito user pool and app client from the console into Terraform, using `terraform import` for the existing pool or recreating it in the production account. Record which you chose.
2. Create IAM roles for each workload with least privilege:
   - `web`: read the documents bucket (presign), write to SQS `chat.fifo`, read the session and Centrifugo secrets.
   - `chat-worker`: read and write its data needs, receive from `chat.fifo`, read Gemini secret, no access to the documents bucket.
   - `indexing-worker`: read the documents bucket, receive from `indexing`, read the Gemini secret, no access to chat queues.
   - `outbox-dispatcher`: read and update the outbox (through the database role), send to both queues, no S3 access.
3. Decide between EKS Pod Identity and IRSA for Phase 5, and record the decision in an ADR. **Verify** the current recommendation from AWS for new clusters.

**Done when:** each role's policy is reviewed in a pull request, and a test shows that a worker cannot read a secret or bucket it does not need (use the IAM policy simulator, and record the result).

### Step 4.5: Container registry

Create ECR repositories for each image:
- Image scanning on push.
- Tag immutability on.
- Lifecycle policy to keep the last N images (choose N and record it).

**Done when:** a manual push of one image succeeds, and the scan result is visible.

### Step 4.6: Restore test

This step proves recoverability. Do not skip it.

1. Load a known dataset into the demonstration database: a fixed number of documents and chunks, with a checksum query.
2. Create a manual snapshot.
3. Restore the snapshot to a new, isolated instance (not the original).
4. Run the same checksum query on the restored instance. The result must match.
5. Record: time to restore (RTO), the backup window and retention (RPO), and the checksum result.
6. Destroy the restored instance.

**Done when:** the checksums match, and the record is in `docs/evidence/restore-test.md`.

### Step 4.7: Tagging, cost controls, and teardown

1. Tag every resource through the provider's default tags: `project=chatlium`, `environment`, `owner`, `cost_center`.
2. Create a teardown script that destroys the demonstration environment, with a confirmation prompt, and reports any resources left behind.
3. Record the actual monthly cost of the demonstration environment running for one day, from Cost Explorer.

**Done when:** `terraform destroy` removes the environment cleanly, the teardown script reports nothing left behind, and the daily cost is recorded.

### Phase 4 exit checklist
- [ ] State bucket uses native S3 locking, and Terraform is 1.10 or later
- [ ] Network created with a controlled NAT mode, and costs recorded
- [ ] Data services created, encrypted, and reachable only from the application subnet
- [ ] Cognito managed by Terraform, with the decision recorded
- [ ] Each workload role tested for least privilege
- [ ] ECR repositories with immutable tags and scanning
- [ ] Restore test completed and recorded
- [ ] Teardown is clean, and the daily cost is recorded

---

## Phase 5: Kubernetes and delivery

**Goal:** A merged change reaches a running EKS cluster through GitOps, with policy enforcement and a tested rollback.

### Step 5.1: EKS cluster

Create the EKS cluster with Terraform, using the community EKS module (**Verify** its current version and its compatibility with your Terraform version).

- Kubernetes version 1.36. Record the choice. **Verify** support status on the EKS release calendar.
- A managed node group for system components, on-demand, across three AZs.
- Pod Identity agent add-on (or IRSA, per the Phase 4 ADR).
- Control plane logging on, with a retention period.
- Public API endpoint restricted to your IP address, or private with a bastion. Record which.

**Done when:** `kubectl get nodes` shows the system nodes ready, and `kubectl auth can-i` confirms your admin access.

### Step 5.2: Cluster add-ons

Install each with Helm, pinned to a version you verified:
1. AWS Load Balancer Controller (for ALB ingress).
2. metrics-server (for HPA).
3. External Secrets Operator (syncs Secrets Manager into Kubernetes Secrets).
4. Karpenter (node provisioning), with its controller on the system node group.
5. KEDA (queue-based scaling).
6. Kyverno (policy).
7. Argo CD (GitOps).

**Verify** the compatible version of each add-on for Kubernetes 1.36 before installing.

**Done when:** each add-on's pods are running, and `kubectl get pods -A` shows no crash loops.

**Watch out:** Install add-ons through Terraform or Argo CD, not by hand, so they are reproducible. Record the method you choose.

### Step 5.3: GitOps repository

Create a second repository, `chatlium-platform`:

```
chatlium-platform/
├── apps/                 # Argo CD Application definitions (app-of-apps)
├── charts/
│   ├── web/
│   ├── chat-worker/
│   ├── indexing-worker/
│   ├── outbox-dispatcher/
│   └── centrifugo/
├── environments/
│   └── demo/             # values per environment
├── policies/             # Kyverno policies
└── docs/
```

Create an app-of-apps: one root Argo CD Application that points to `apps/`. Sync it to the cluster.

**Done when:** Argo CD shows the root application as synced and healthy.

### Step 5.4: Helm charts

For each workload, a chart with:
- Deployment with resource requests and limits.
- Liveness and readiness probes (matching `/healthz` and `/readyz` from Phase 3).
- `terminationGracePeriodSeconds` matching the application's shutdown timeout.
- Security context: non-root, read-only root filesystem where possible, no privilege escalation, dropped capabilities.
- PodDisruptionBudget for `web` and `centrifugo`.
- Topology spread constraints across AZs.
- A ServiceAccount bound to the workload's IAM role (per step 4.4).
- Environment from a ConfigMap for non-secret values and from External Secrets for secrets.

**Done when:** `helm lint` and `helm template` pass for each chart, and Argo CD syncs them.

### Step 5.5: Database migrations as a deployment step

Run migrations as an Argo CD PreSync hook, using a Job that connects as the owner role (credentials from Secrets Manager). The application pods start after the migration succeeds.

**Done when:** a change that adds a migration applies it before the new pods start, and a failed migration blocks the rollout.

**Watch out:** Migrations must be backward-compatible with the running version during a rolling update. Adding columns is safe. Dropping or renaming a column requires two deployments. Write this rule into the contributing guide.

### Step 5.6: Ingress and WebSocket routing

Create an ALB ingress with path rules:
- `/connection/*` and the Centrifugo WebSocket path: to the `centrifugo` service.
- `/api/*` and all other web paths: to the `web` service.

Configure:
- Idle timeout above Centrifugo's ping interval (**Verify** Centrifugo's default, currently documented as 25 seconds). Choose a value and test it.
- Health checks on each target group.

Test: open a WebSocket through the ALB, leave it idle for longer than the ping interval, and confirm it stays open. Then drop the connection and confirm reconnection.

**Done when:** the WebSocket test passes through the ALB.

### Step 5.7: CloudFront for the widget and the API

- A CloudFront distribution with two origins:
  - Widget assets bucket, through origin access control. Cache behavior: immutable versioned assets get long cache lifetimes. The stable `widget.js` loader gets a short cache lifetime.
  - ALB for the API. Caching disabled for `/api/*`. Forward authorization, cookie, and origin headers.
- CORS headers for widget assets.
- Deploy the widget build artifacts to the bucket in the CI pipeline (step 5.8).

**Done when:** the widget loads on the test host page through CloudFront, and the loader references the correct versioned bundle.

### Step 5.8: CI/CD pipeline

Extend `.github/workflows/`:
1. Build and test as before.
2. Build each image, and scan with Trivy. Fail on HIGH and CRITICAL findings that have a fix available. Record any exceptions in a file with an expiry date.
3. Authenticate to AWS with GitHub OIDC. The IAM role's trust policy limits access to this repository and to the `main` branch. No long-lived AWS keys in GitHub.
4. Push each image to ECR, tagged with the commit SHA and captured by digest.
5. Open a pull request to `chatlium-platform` that updates the image digests in `environments/demo`.
6. After merge, Argo CD deploys the new digests.

**Done when:** a merge to `main` produces a pull request in the platform repository, and merging it deploys the new version.

**Watch out:** Deploy by digest, not tag. A tag can be moved; a digest cannot.

### Step 5.9: Kyverno policies

Write policies for:
- No privileged containers.
- Resource requests and limits required.
- Images must come from your ECR registry.
- Required labels (`app.kubernetes.io/name`, `app.kubernetes.io/part-of`).
- Probes required on web and workers.

Start in audit mode. Review the reports. Then switch to enforce.

**Test:** apply a deliberately violating manifest, confirm it is rejected at admission with a clear message, and record the result.

**Done when:** the violating manifest is rejected, and a compliant one is accepted.

### Step 5.10: Rollback drill

1. Deploy a known-good version. Record its digest.
2. Deploy a deliberately broken version (for example, a readiness probe that fails).
3. Observe Argo CD show the rollout as degraded.
4. Roll back by reverting the platform repository commit.
5. Confirm the cluster returns to the known-good digest.
6. Record the time from broken deployment to recovery.

**Done when:** the rollback is recorded with its time, and the cluster is healthy.

### Phase 5 exit checklist
- [ ] EKS 1.36 running, with add-ons pinned and healthy
- [ ] GitOps repository syncs through Argo CD
- [ ] Charts pass lint, and workloads run with probes and security contexts
- [ ] Migrations run as a PreSync step
- [ ] WebSocket works through the ALB, including idle time and reconnection
- [ ] Widget served through CloudFront with versioned assets
- [ ] Merge to deployment works through OIDC and digests
- [ ] Kyverno rejects a violating manifest
- [ ] Rollback drill recorded
- [ ] Real-SQS contract tests run and recorded (from Step 3.5)

---

## Phase 6: Scaling and reliability

**Goal:** The system scales with load, and you have measured how. Failures are injected and recovered, with evidence.

### Step 6.1: Horizontal scaling for the web tier

- HPA on the `web` deployment, targeting CPU utilization. Choose the target and record it.
- Min replicas 2 across AZs. Max replicas bounded by your budget.

**Done when:** a load test increases replicas, and they decrease after the load ends.

### Step 6.2: Queue-based scaling with KEDA

- A ScaledObject for `chat-worker` using the SQS scaler, targeting visible messages per replica. Choose the target and record the reasoning.
- A ScaledObject for `indexing-worker` on the `indexing` queue.
- Minimum replicas for chat at 1 (to avoid cold-start latency for visitors). Minimum 0 for indexing is acceptable.
- Scaling uses the same pod identity as the worker.

**Watch out:** FIFO queues scale by message group. One busy conversation cannot be processed in parallel. Note this limit in the README: scaling helps across conversations, not within one conversation.

**Done when:** a burst of messages to `chat.fifo` scales the chat worker up, and it scales back down after draining.

### Step 6.3: Node scaling with Karpenter

- A NodePool for application workloads, spot-preferred with on-demand fallback, across three AZs.
- A separate NodePool, or the system node group, for platform components.
- Consolidation enabled, with a disruption budget.
- Spot interruption handling configured as Karpenter requires. **Verify** the current requirement for an interruption queue.

**Done when:** pods that cannot be scheduled cause new nodes to appear, and idle nodes are removed after the consolidation period.

### Step 6.4: Load test plan

Before running any test, write `docs/load-test-plan.md`:
- Scenarios: baseline, burst, soak (from the baseline document).
- Pass criteria: targets you set from a baseline measurement, not from guesses.
- What you will record: request rate, latency percentiles, error rate, queue depth and age over time, replica count, node count, database connections and CPU, time to first token, and AWS cost during the test.

Then run the baseline first, record the numbers, and set the targets for burst and soak from those numbers.

**Done when:** the plan exists before the first test run, and the baseline results are recorded.

### Step 6.5: Run the load tests

Use k6. Scripts live in `load/`. Each script:
- Creates or uses a fixed test workspace with a known document.
- Simulates visitors sending questions through the widget API.
- Records custom metrics for time to first token and end-to-end completion.

Run baseline, burst, and soak. For each, save the k6 output and a Grafana screenshot to `docs/evidence/load/`.

**Done when:** all three runs are complete, with results compared against the targets in the plan. Record any target that was missed, and why.

### Step 6.6: Failure injection in the cluster

Run each test, record the result, and write a runbook for each in `docs/runbooks/`:

1. **Worker pod killed during a job.** Expected: job completes once, no duplicate reply.
2. **Node drained with active workers.** Expected: pods reschedule, PodDisruptionBudgets respected, no lost messages.
3. **LLM provider dependency failure.** Simulate by pointing the model adapter at a blackhole endpoint in a test environment, or by injecting timeouts. Expected: bounded retries with backoff, failed jobs reach the DLQ after the limit, visitors see a clear failure state.
4. **Database restore.** Restore to a point in time into an isolated instance, verify with the checksum, and record the time (this extends step 4.6 with the application pointed at it).
5. **Queue backlog.** Pause workers, build a backlog, resume, and record the time to drain.

**Done when:** each test's result and runbook exist, and each runbook has been followed at least once.

### Phase 6 exit checklist
- [ ] HPA, KEDA, and Karpenter all demonstrated with recorded evidence
- [ ] Load test plan written before runs
- [ ] Baseline, burst, and soak recorded against targets
- [ ] Five failure tests recorded, with runbooks
- [ ] FIFO group-scaling limit documented

---

## Phase 7: Observability and security hardening

**Goal:** You can see what the system is doing, follow one message end to end, and see what it costs. The security controls are tested, not just described.

### Step 7.1: OpenTelemetry instrumentation

- Add the OpenTelemetry SDK to `web`, `chat-worker`, `indexing-worker`, and `outbox-dispatcher`.
- Auto-instrument HTTP and database calls. Add manual spans for the workflow executor, retrieval, LLM calls, and queue operations.
- Propagate trace context through SQS message attributes using W3C `traceparent`. Without this, the trace breaks at the most important boundary.
- Each execution writes its `trace_id` to the `executions` row. Each `llm_calls` row carries the `trace_id`.

**Done when:** one visitor message produces a single trace in the tracing backend that spans the web request, the outbox, the queue, the worker, the retrieval, and the LLM call.

### Step 7.2: Telemetry allowlist and sanitization

- Create one telemetry module that all spans, logs, and metrics go through.
- Add a span processor that removes any attribute not on the allowlist from `chatlium-usage-observability.md` section 6 and `chatlium-greenfield-decisions.md` section 6.
- Configure the Vercel AI SDK telemetry with `recordInputs: false` and `recordOutputs: false` (already set in Phase 2, verify it still holds).
- Pin the GenAI attribute names to one convention version, in one constants module. **Verify** the names against the current OpenTelemetry convention version before pinning.

**Test:** run a sample execution with a sentinel string in the visitor's message, a document, and a tool argument. Scan all exported spans, logs, and metric labels. The sentinel must not appear.

**Done when:** the sentinel scan passes. Keep the test in CI.

### Step 7.3: Telemetry backends

- OpenTelemetry Collector deployed in the cluster.
- Tempo for traces, with short retention (choose 3 to 7 days) and a sampling rate. Keep all error traces.
- Prometheus for metrics, with bounded labels only (provider, model, node type, outcome). Never workspace ID or run ID.
- Grafana for dashboards.
- Logs to CloudWatch Logs through the cluster's log collector. Set a retention period.

Record the monthly cost of this stack in the build log. If it exceeds your budget, reduce retention or sampling, or run it only during demonstrations.

**Done when:** the trace from Step 7.1 is visible in Tempo, metrics appear in Prometheus, and logs appear in CloudWatch.

### Step 7.4: Dashboards and alerts

Build Grafana dashboards for:
- API request rate, latency percentiles, and error rate.
- Queue depth and oldest message age for each queue, and DLQ depth.
- Worker processing time and retry count.
- LLM time to first token and total duration.
- Estimated spend per hour, by provider and model.
- Pod restarts and node utilization.

Alerts:
- Oldest message age above a threshold for 5 minutes.
- Any message in a DLQ.
- Web error rate above a threshold.
- Spend rate above a threshold (spike detection).
- Readiness failures on any workload.

**Test:** trigger each alert deliberately and record that it fired and reached its channel.

**Done when:** each alert has fired once in a test, and the test results are recorded.

### Step 7.5: Usage views in the dashboard

Extend the Phase 2 usage view:
- Overview: estimated cost and tokens for a date range, with a daily chart.
- By model: cost and tokens per provider and model.
- By conversation: sortable list with runs, cost, and escalation status.
- Run detail: execution timeline with each node's duration, status, tokens, and cost. Retrieval steps show document references and scores.
- Trace link: opens the trace in Tempo, only after the server checks the user's workspace membership. A trace ID is never an authorization token.
- Indexing costs shown per document, separate from conversation costs.

**Test:** a user from workspace A cannot open a trace from workspace B by guessing or copying its ID. Record the result.

**Done when:** the views match the database totals in tests, and the cross-tenant trace test passes.

### Step 7.6: Web Application Firewall

Attach AWS WAF to CloudFront (or the ALB, if the API is reached directly):
- AWS managed rule groups for common threats.
- A rate-based rule on the widget session and message endpoints.
- Logging enabled to CloudWatch or S3.

**Test:** exceed the rate limit from one IP and confirm blocking. Record the threshold and the response.

**Done when:** the rate-based rule blocks in test, and the rule and its threshold are documented.

### Step 7.7: Widget abuse protection tests

Each control from the amendments, with a test:
- Signed, short-lived token: expired token refused. Token for widget A refused on widget B.
- Origin allowlist: non-allowlisted origin refused.
- Payload size: oversized body refused before parsing.
- Per-IP and per-widget rate limit: limit triggers at the threshold and clears after the window.
- Repeated abusive pattern: temporary block clears after the window.

Run these in CI against the deployed demo environment as a smoke test, as well as in unit tests.

**Done when:** all five controls have passing tests, and the CI smoke test runs against the demo.

### Step 7.8: Tenant isolation, extended

Extend the Phase 1 isolation suite to cover:
- Usage tables (`llm_calls`, `embedding_calls`, usage rollups).
- Realtime channels (visitor and operator).
- Trace links from the dashboard.
- Document chunks through the retrieval API.
- Workflow versions and executions.

Each new table or endpoint gets at least one cross-tenant test.

**Done when:** the suite covers every tenant-owned table and every tenant-scoped endpoint, and CI runs it.

### Step 7.9: Data deletion

Implement and test:
- **Document deletion:** removes the S3 object and all its versions (permanent delete, following the retention policy), its chunks and vectors, and its embedding usage links are preserved as usage records but the content is removed.
- **Workspace deletion:** removes all of the workspace's data, documents, conversations, messages, and widgets. Usage records are retained according to the retention policy, with the workspace reference anonymized if the policy requires.
- **Conversation retention:** a scheduled job deletes conversations and messages older than the retention period.

Tests:
- Deleting a document leaves no chunks, no vectors, and no non-current S3 versions.
- Deleting workspace A leaves workspace B's data intact.
- The retention job deletes only expired conversations.

**Done when:** the three tests pass, and a manual check in S3 confirms no versions remain.

**Watch out:** S3 versioning means "delete" creates a delete marker, and the previous versions remain. The deletion code must remove the versions explicitly.

### Step 7.10: Security review and supply chain

- Gitleaks in CI to detect committed secrets.
- Dependency audit in CI, with failures for known high-severity issues that have fixes.
- Container image scanning already in place from Phase 5; confirm it blocks.
- Review the IAM policies once more against the workloads, and record the review.
- Review the security headers on the dashboard (Content Security Policy, `X-Content-Type-Options`, `Referrer-Policy`, `Frame-Options` or equivalent). Test with a header scanner.

**Done when:** each control is in CI, and the review is recorded in `docs/security-review.md`.

### Phase 7 exit checklist
- [ ] One message traces end to end
- [ ] Sentinel scan passes for spans, logs, and metric labels
- [ ] Dashboards and alerts each fired once in a test
- [ ] Usage views match database totals, and cross-tenant trace access is refused
- [ ] WAF rate rule tested
- [ ] Five widget abuse controls tested in CI
- [ ] Isolation suite covers every tenant table and endpoint
- [ ] Deletion tests pass, including S3 versions
- [ ] Security review recorded

---

## Phase 8: Simple workflow editor

**Goal:** Operators can change the order of nodes and the condition thresholds through a simple editor, and every change is a validated, immutable version. Keep it simple. The full canvas is a roadmap item.

### Step 8.1: Workflow schema and validation

- Define the graph schema with Zod: node types from a fixed registry, node configuration per type, and edges.
- Validation rules: the graph has exactly one entry node, all nodes are reachable, every Condition has both branches, Action nodes are terminal, and no node type outside the registry is accepted.

Tests: a valid graph passes; each invalid case (unknown type, unreachable node, missing branch, action not terminal) is refused with a specific error.

**Done when:** the tests pass.

### Step 8.2: Node registry

Register the four node types with their configuration schemas:
- Knowledge: which documents to search (all, or a selection), top-K, minimum score.
- LLM: model name from an allowlist, temperature within a range, system prompt template with a fixed set of variables.
- Condition: a rule from a fixed set (score below threshold, visitor requests a person).
- Action: `send_message` or `escalate_human`.

The LLM system prompt is a template. Variables come from a fixed list, and anything else is refused.

**Done when:** each node's configuration is validated, and an invalid configuration is refused with a clear error.

### Step 8.3: Versioning and publish

- Saving a draft updates `workflows.draft`.
- Publishing creates a new immutable `workflow_versions` row with an incrementing version number. Old versions are never edited.
- New executions use the latest published version. Executions already running keep the version they started with.

Tests:
- Publishing creates version N+1 and leaves version N unchanged.
- A running execution keeps its version after a new publish.
- A draft change does not affect the published version.

**Done when:** the three tests pass.

### Step 8.4: Editor UI

Build a form-based editor in `apps/web`:
- The node order is shown as an ordered list, with add, remove, and reorder controls.
- Each node opens a configuration form generated from its schema (from step 8.2).
- Validation errors from the server are shown next to the field.
- Save draft and publish are separate actions.

Use React Flow only if you have time left after the rest of the phase. It is on the cut list.

**Done when:** an operator can change the threshold and the node order, publish, and see the next conversation use the new version.

### Step 8.5: Editor tests

- End-to-end: edit the threshold, publish, ask a question near the boundary, and confirm the behavior changes as expected.
- Permissions: an `operator` cannot publish. An `admin` can.

**Done when:** both tests pass.

### Phase 8 exit checklist
- [ ] Graph validation refuses each invalid case with a specific error
- [ ] Versions are immutable, and running executions are pinned
- [ ] Editor changes take effect for new conversations only
- [ ] Permissions for publishing are enforced and tested

---

## Phase 9: Evidence and write-up

**Goal:** Someone who has never seen the project can understand what it does, how it is built, what it costs, and how you know it works.

### Step 9.1: README

Write the top-level README with:
- One-paragraph description, and the architecture diagram (use Mermaid, which GitHub renders).
- The two environments: the cost-optimized demonstration (single NAT, single-AZ database) and the production design (three AZs, Multi-AZ). Say clearly which one is running at any time.
- Quick start for local development (one command).
- Links to the decision records, the runbooks, and the load test results.
- Measured numbers only. Every performance claim links to its evidence.

**Done when:** a reader can start the local stack from the README alone.

### Step 9.2: Demonstration recording

Record a single continuous run, under five minutes, covering:
1. Deploy the demonstration environment from Terraform and Argo CD.
2. Generate traffic and show the workers scaling from queue depth.
3. Push a failing job to the DLQ and show the alert.
4. Find the failure on the Grafana dashboard.
5. Recover: fix the cause, replay the DLQ message, and show it complete once.
6. Show a message's end-to-end trace.
7. Show the usage view for the run.

Save the recording and a written script in `docs/evidence/`.

**Done when:** the recording exists and matches the script.

### Step 9.3: Incident write-up

Write one incident report from a real failure you hit during the build. Use this structure:
- Summary, timeline, impact, root cause, detection, resolution, what you changed afterward, and what you would do differently.

Pick a real failure from the build log. Do not invent one.

**Done when:** the report is in `docs/incidents/` and linked from the README.

### Step 9.4: Cost report

From Cost Explorer, record:
- The cost of each phase's AWS usage, as far as it can be separated.
- The daily cost of the demonstration environment.
- The estimated monthly cost of the production design (calculated, not measured, and labeled as estimated).

Put the numbers in `docs/cost-report.md`. Show the calculation for any estimate.

**Done when:** the report exists, and each number is either measured or labeled as an estimate with its calculation.

### Step 9.5: Final verification and teardown

1. Run the full test suite in CI on a clean clone.
2. Run the acceptance test against the demonstration environment.
3. Destroy the demonstration environment with the teardown script. Confirm no resources remain.
4. Revoke the Gemini key you created for development, or rotate it, and confirm the application no longer works with the old one.
5. Remove any test users and data that should not persist.

**Done when:** the clean clone passes CI, the environment is destroyed, and the checklist is recorded in `docs/build-log.md`.

### Phase 9 exit checklist
- [ ] README complete, with measured claims only
- [ ] Demonstration recording and script saved
- [ ] Incident report from a real failure
- [ ] Cost report with measured and estimated numbers labeled
- [ ] Clean clone passes CI, environment destroyed, keys rotated

---

## Appendix A: Expected repository layout at the end

```
chatlium/
├── apps/
│   ├── web/                    Next.js dashboard and API
│   ├── widget/                 Vite widget, loader and versioned bundle
│   ├── chat-worker/
│   ├── indexing-worker/
│   └── outbox-dispatcher/
├── packages/
│   ├── auth/                   sessions, token verification, membership checks
│   ├── ai/                     LLMProvider interface, Gemini adapter, telemetry constants
│   ├── config/                 environment schema
│   ├── contracts/              event and API schemas
│   ├── crypto/                 session sealing
│   ├── db/                     Drizzle schema, migrations, tenant context helpers
│   ├── knowledge/              extractors, chunking, embeddings, retrieval
│   ├── observability/          logger, telemetry allowlist
│   ├── queue/                  MessageQueue interface, SQS adapter, test adapter
│   ├── realtime/               Centrifugo publisher and token issuing
│   ├── security/               rate limiting, origin checks, SSRF guard
│   ├── storage/                S3 adapter
│   ├── tsconfig/
│   └── workflow/               graph schema, node registry, executor, versions
├── infra/terraform/            modules and environments
├── load/                       k6 scripts
├── docs/
│   ├── adr/
│   ├── decisions/
│   ├── evidence/
│   ├── incidents/
│   ├── runbooks/
│   ├── build-log.md
│   ├── cost-report.md
│   ├── load-test-plan.md
│   └── security-review.md
├── docker/
├── docker-compose.yml
└── README.md
```

The GitOps repository (`chatlium-platform`) holds the Helm charts, Argo CD applications, Kyverno policies, and environment values.

---

## Appendix B: Troubleshooting

| Symptom | Likely cause | Check first |
|---|---|---|
| Integration tests hang | Docker not running, or Testcontainers cannot pull an image | `docker ps`, then the image pull |
| Tenant query returns rows it should not | Connected as owner or superuser, or `FORCE` missing | `rolsuper`, `rolbypassrls`, `relforcerowsecurity` |
| Tenant query returns zero rows unexpectedly | Context not set, or `set_config` called outside the transaction | Confirm `withWorkspace` wraps the query |
| Sign-in loops or fails at callback | Callback URL mismatch, or `state` or `nonce` check failing | The redirect URI in the Cognito app client |
| Token rejected | Wrong audience, issuer, or `token_use` | Decoded claims against the configured values |
| Queue messages out of order | Missing `MessageGroupId`, or using Standard instead of FIFO | The queue type and the publish parameters |
| Duplicate assistant messages | Claim lease not in place, or side effects outside the completion transaction | `processed_messages` status for the job |
| Terraform hangs on plan | State lock held by an interrupted run | The `.tflock` object in the state bucket |
| Pods crash on startup | Missing environment variable | The config validation message in the logs |
| WebSocket drops after about a minute | ALB idle timeout too short | The load balancer attributes |
| Widget loads but does not connect | Origin not allowlisted, or wrong API base URL | The browser console and the widget's configuration |
| Costs higher than expected | NAT gateways, interface endpoints, or a forgotten resource | Cost Explorer by service, and the teardown report |

---

## Appendix C: What to do if you fall behind

Reduce scope in this order, and never reduce tests or failure evidence:
1. Phase 8 editor: keep the fixed default graph only.
2. Phase 7 extras: keep tracing, the usage view, and the alerts you need for the demonstration. Defer the extra dashboards.
3. Phase 6 extras: run the three load tests and two failure tests, not all five.
4. Phase 5 extras: skip the optional add-ons, but keep Argo CD, Kyverno, and the rollback drill.

Do not cut the isolation tests, the queue contract tests, the restore test, or the teardown.
