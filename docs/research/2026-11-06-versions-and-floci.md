# Versions and Floci research — 2026-11-06

Checked against npm, GitHub releases, Docker Hub, and the AWS EKS docs on 2026-11-06.
Versions are pinned at the step that installs each one; this file is the reference.

## 1. Runtime and CLI tools

| Tool          | Installed                    | Latest                                                                       | Action                                                                                                                               |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js       | 22.15.1                      | **26.13.0** (Active LTS "Lithium", 2026-10-28). 24.22.2 is the previous LTS. | **Installed system-wide via winget `OpenJS.NodeJS.LTS` (replaced Node 22).** Pinned in `.nvmrc`. No version manager (owner's choice) |
| fnm           | —                            | 1.39.0                                                                       | Not used: owner chose a plain system Node (installed, then removed 2026-11-06)                                                       |
| pnpm          | **12.18.0** (global via npm) | 12.18.0                                                                      | Corepack is no longer bundled with Node 26, so pnpm is installed globally with npm. Pin in the `packageManager` field                |
| Git           | 2.49.0                       | —                                                                            | OK                                                                                                                                   |
| Docker Engine | 29.9.2 (Docker Desktop)      | —                                                                            | OK, daemon running                                                                                                                   |
| AWS CLI v2    | 2.36.29                      | —                                                                            | OK                                                                                                                                   |
| Terraform     | 1.12.2                       | **1.17.1**                                                                   | Upgrade before Phase 4                                                                                                               |
| kubectl       | 1.36.2                       | 1.37.2 upstream                                                              | OK: matches EKS 1.36                                                                                                                 |
| Helm          | 4.2.1                        | **4.3.1**                                                                    | Upgrade before Phase 5                                                                                                               |
| k6            | missing                      | 2.3.0                                                                        | Install before Phase 6                                                                                                               |
| GitHub CLI    | **2.103.3**                  | 2.103.3                                                                      | Installed. Needs `gh auth login`                                                                                                     |
| floci-cli     | missing                      | 0.4.0                                                                        | Optional: we run Floci via Docker Compose                                                                                            |

## 2. Container images

| Image                   | Latest tag                                            | Use                                           |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------- |
| `floci/floci`           | **2.4.0** (2026-10-31)                                | Local AWS emulator. Pin `2.4.0`, not `latest` |
| `pgvector/pgvector`     | **0.8.7-pg18-trixie** (PostgreSQL 18, pgvector 0.8.7) | Local DB + Testcontainers. PG 19 is still RC1 |
| `redis`                 | **8.10.3-alpine**                                     | Local Redis (rate limits)                     |
| `centrifugo/centrifugo` | **v6.10.2**                                           | Realtime                                      |

## 3. npm packages (latest stable)

| Area            | Package                                                             | Latest                                               |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Monorepo        | turbo                                                               | 2.11.10                                              |
| Language        | typescript                                                          | 7.0.2 latest, **6.0.3 last 6.x**. **Question 2**     |
| Lint            | eslint / typescript-eslint / prettier                               | 10.14.0 / 8.72.1 / 3.9.10                            |
| Web             | next / react / tailwindcss                                          | 16.4.5 / 19.3.1 / 4.3.5                              |
| Widget          | vite / @vitejs/plugin-react                                         | 8.3.6 / 6.2.1                                        |
| Data fetching   | @tanstack/react-query                                               | 5.106.1                                              |
| Validation      | zod                                                                 | 4.6.7                                                |
| Logging         | pino                                                                | 10.4.0                                               |
| DB              | drizzle-orm / drizzle-kit                                           | 0.45.4 / 0.31.11 (1.0.0-rc.5 exists). **Question 3** |
| DB driver       | pg / postgres                                                       | 8.23.1 / 4.1.0. **Question 4**                       |
| AI              | ai / @ai-sdk/google                                                 | 7.0.163 / 4.0.112                                    |
| Auth            | openid-client / jose / iron-session                                 | 6.8.9 / 6.2.15 / 9.0.1                               |
| AWS SDK v3      | client-sqs, client-s3, s3-request-presigner, client-secrets-manager | 3.1163.0                                             |
| Redis client    | redis / ioredis                                                     | 6.3.1 / 6.0.0                                        |
| PDF             | unpdf / pdfjs-dist                                                  | 2.1.0 / 6.5.438                                      |
| Realtime client | centrifuge                                                          | 5.8.0                                                |
| Telemetry       | @opentelemetry/sdk-node / api                                       | 0.301.0 / 1.10.0                                     |
| Tests           | vitest / testcontainers / @playwright/test                          | 5.1.0 / 12.2.1 / 1.65.0                              |

Compatibility findings:

- **typescript-eslint 8.72.1 requires `typescript >=4.8.4 <6.1.0`.** TypeScript 7 is outside that range, so type-aware linting would fail.
- Node engines: `ai` needs >=22, `testcontainers` needs >=22.22, `vitest` supports 22.12+/24/26+. Node 26 satisfies all of them.

## 4. Platform components (Phase 5+)

| Component                    | Latest                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| EKS Kubernetes               | **1.36** is the newest EKS version (1.37 is upstream-only so far). The guide's 1.36 is correct |
| Argo CD                      | 3.6.1                                                                                          |
| Kyverno                      | 1.19.2                                                                                         |
| KEDA                         | 2.21.0                                                                                         |
| Karpenter                    | 1.15.1                                                                                         |
| External Secrets (chart)     | 2.14.0                                                                                         |
| AWS Load Balancer Controller | 3.6.2                                                                                          |
| Tempo                        | 3.1.1                                                                                          |
| OTel Collector               | 0.164.0                                                                                        |

Each must still be checked for compatibility with Kubernetes 1.36 at Step 5.2.

## 5. Floci 2.4.0

### Cleanup done

Removed the old Floci setup (v1.7.0, built 2026-08-18): image `floci/floci:latest`, its child containers
(`floci-valkey-chatlium-redis`, `floci-msk-*`), the volumes `floci-msk-*` and `floci-rds-db-*`, the
child images `valkey/valkey:8` and `redpandadata/redpanda:latest`, and the network `awsfloci_default`.
Pulled `floci/floci:2.4.0` fresh.

### Smoke test (2.4.0, in-memory, on this machine)

| Check                                     | Result                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Startup                                   | `floci 2.4.0 native` started in 0.13 s on :4566                                          |
| SQS FIFO `chat.fifo`, dedup ID sent twice | Same MessageId both times; 1 message visible ✅                                          |
| Cognito pool discovery                    | issuer `http://localhost:4566/<poolId>`, `code_challenge_methods_supported: ["S256"]` ✅ |
| S3 bucket versioning                      | `Enabled` ✅                                                                             |
| Secrets Manager create                    | ✅                                                                                       |

### How we will run it

- Image variants: **standard** (`2.4.0`, recommended), `-compat` (adds AWS CLI + boto3 inside, needed if init hooks call `aws`), `-baseline` (old ARM only). Release images are cosign-signed. Nightly images are not.
- Compose essentials:
  - `FLOCI_HOSTNAME=floci` so SQS `QueueUrl` and presigned URLs resolve from other containers.
  - `FLOCI_STORAGE_MODE` = `memory` (tests/CI) or `persistent`/`hybrid` (dev) plus a volume on `/app/data`.
  - Init hooks: mount scripts at `/etc/floci/init/ready.d` to create queues, buckets, the Cognito pool and secrets on startup (`-compat` image if scripts use `aws`).
  - Default credentials `test`/`test`, region `us-east-1`, account `000000000000`.
  - The Docker socket is needed **only** for container-backed services (RDS, ElastiCache, Lambda, MSK, EKS).
- Test helpers: `GET /_aws/sqs/messages?QueueUrl=…` peeks queue contents without consuming them (useful for the outbox and DLQ tests). `/_aws/ses` shows sent emails (Cognito codes).

### Per service, for Chatlium

| Service                                                | Floci 2.4.0                                                                                                                                                                                                             | Use in Chatlium                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| SQS                                                    | In-process. FIFO, dedup ID, group ID, visibility, DLQ redrive, `StartMessageMoveTask`; publishes `AWS/SQS` CloudWatch metrics                                                                                           | Steps 3.4/3.5. `StartMessageMoveTask` covers the DLQ replay in 3.9 |
| Cognito                                                | In-process. Managed login with auth code + **PKCE S256**, `nonce` carried into the ID token, discovery + JWKS, refresh grant (2.3), revocation (2.3), logout, MFA incl. SMS/email (2.4), password policy enforced (2.0) | Could replace the AWS dev pool in Step 1.9. **Question 5**         |
| S3                                                     | In-process. Versioning, `ListObjectVersions`, presigned URLs SigV4-signed (2.2), presigned CORS preflight (2.2)                                                                                                         | Steps 2.2 and 7.9                                                  |
| Secrets Manager, KMS                                   | In-process                                                                                                                                                                                                              | Phase 3 config                                                     |
| RDS                                                    | Real Postgres container. Default image `postgres:16-alpine`, overridable via `FLOCI_SERVICES_RDS_DEFAULT_POSTGRES_IMAGE`; snapshots, restore, automated backups (2.4)                                                   | Not used for the app DB (see section 6). **Question 6**            |
| ElastiCache                                            | Real Redis/Valkey container                                                                                                                                                                                             | Not needed: plain Redis container                                  |
| ECR, EKS (k3s), CloudFront, WAFv2, Budgets, CloudWatch | Emulated (WAF is management API only and does not filter traffic)                                                                                                                                                       | Optional rehearsal of Terraform before real AWS                    |

### Changes since 1.7.0 that help us

- **2.0.0:** Cognito enforces password policies and AWS-accurate `UsernameAttributes` (UUID username = `sub`). Defaults match AWS so a second `terraform plan` shows no drift. Only breaking change: Step Functions JSONata (we don't use it).
- **2.2.0:** S3 presigned URLs signed with SigV4, presigned CORS, bucket-policy grants on presigned POST. Cognito scopes OAuth tokens to the requested scopes. ElastiCache re-provisions after restart.
- **2.3.0:** Cognito `refresh_token` grant and `/oauth2/revoke` on the OAuth endpoint (needed for our 7-day refresh). Token validity limits enforced as on AWS.
- **2.4.0:** SQS → CloudWatch metrics (lets us rehearse queue-age alarms locally). Opt-in AWS-style `QueueUrl` (`FLOCI_SERVICES_SQS_ENDPOINT_STRATEGY=aws`). RDS automated backups and restore. ECR push/pull + scanning config. Cognito SMS/email MFA.

### Known differences from AWS that matter for us

- **Cognito issuer host:** tokens carry `iss = <Floci base URL>/<poolId>`. With `FLOCI_HOSTNAME=floci` the issuer becomes `http://floci:4566/...`, but the browser must reach the authorize URL on `localhost:4566`. Server and browser see different hosts, so the issuer check in Step 1.11 needs a deliberate decision.
- Cognito managed login is a plain form with no sign-up, forgot-password or MFA pages. Authorize errors come back as JSON 400, where AWS redirects them to the callback.
- Managed-login sessions are kept in memory and lost when Floci restarts.
- WAF does not inspect traffic, so the Step 7.6 rate-rule test must run on real AWS.

## 6. Recommendation (pending your answers)

- Run **Postgres (pgvector pg18)** and **Redis** as plain containers, as the guide says. Use Floci for **SQS, S3, Secrets Manager, KMS and Cognito**.
- Pin every image by tag (and by digest in CI).

## Decisions taken 2026-11-06

- Node **26 LTS** (26.13.0).
- TypeScript **7.0.2**. Consequence: typescript-eslint (latest 8.72.1 and canary) supports only TS <6.1. Linter: **oxlint 1.92.0 + `oxlint-tsgolint` 7.0.2006** (type-aware on TS 7). ESLint/typescript-eslint is not used, and Prettier stays as the formatter. This replaces the guide's "ESLint and Prettier" in Step 1.1. Record it in an ADR at Step 1.1.
- Development Cognito runs in **Floci**. Real Cognito arrives in Phase 4 via Terraform.
- Old Docker leftovers: **delete all listed**. Done: removed `chatlium-aws`, `chatlium-centrifugo`, `chatlium-nats`, both `chatlium_cloud_native_*` volumes and network, `postgres:16-alpine`, `postgres:15-alpine`, `centrifugo:latest`/`v6`, `nats:2.10-alpine`, `alpine/socat`, and the untagged image. **Not removed:** `postgres:16` and `postgres:latest`, which are still used by the stopped containers `pg-todo` and `some-postgres` (not Chatlium).

## Decision files vs the build guide (reviewed 2026-11-06)

The three files are copied to `docs/decisions/`.

- **Step 0.1 is already satisfied.** Both files commit to Cognito. "Better Auth" appears only as the rejected alternative (decisions §2, amendments §1–2).
- **Tenant context:** amendments §4 shows `SET LOCAL app.workspace_id = '<uuid>'`, while guide Step 1.7 uses `set_config('app.workspace_id', $1, true)`. Both are transaction-local. `set_config` is the form that accepts a bind parameter, so it follows the same rule without the injection risk. We use `set_config`.
- **EKS:** amendments §1 says standard support covers 1.34–1.37, but the AWS docs today list **1.36 as the newest** EKS version. Both agree on starting with 1.36.
- **Phase numbers:** the usage-observability addendum uses older phase numbers ("Phase 1 minimal usage, Phase 6 full"). The greenfield phase order supersedes them: minimal usage lands in guide Phase 2 (Step 2.15) and the full views in Phase 7 (Step 7.5).
- **BYOK fields** (`key_ref`) in the usage addendum are out of scope per decisions §1.
- **Conflicts resolved by the owner (2026-11-06)** and written into the decision record and the guide:
  1. `usage_status` values are `reported`, `estimated` and `unknown`. `unknown` means tokens and cost are null, never zero. The term `unavailable` is dropped.
  2. Unit tests use the in-process `MessageQueue` adapter in every phase. Phase 2 development also uses it. From Phase 3, development and integration tests use the SQS adapter against Floci. There is no Postgres-backed adapter.

## Local-only development

Per decisions §10, daily development is local with Docker Compose and Floci. AWS is created with Terraform only for testing and demos (Phase 4+), then destroyed. The AWS account, region and budget are therefore **deferred to Phase 4**. Before the production demo, amendments §3 requires one run of the queue contract tests against real SQS.

## Leftover Docker items (original list, before cleanup)

- `chatlium-aws:latest`: a Next.js app image from the old `awsfloci` compose project.
- Containers `chatlium-centrifugo`, `chatlium-nats` and volumes `chatlium_cloud_native_postgres-data`, `chatlium_cloud_native_nats-data` from `D:\NIC\chatlium_cloud_native`.
- `postgres:16-alpine` (possibly pulled by the old Floci RDS), `postgres:16`, `postgres:latest`, `postgres:15-alpine`, `centrifugo/centrifugo:latest`/`v6`, `nats:2.10-alpine`, `alpine/socat`, an untagged image `cf78e76683b9`.

## GitHub (2026-11-07)

- `gh` is logged in as **SaadIrfan41** (token scopes: `repo`, `workflow`, `read:org`, `gist`).
- The private repo `SaadIrfan41/chatlium` already exists and holds an older, unrelated build (last push 2026-05-11). It is left untouched.
- The greenfield repo will be **`SaadIrfan41/chatlium-cloud`** (private). The guide's references to the repository `chatlium` mean this repo. The Phase 5 GitOps repo keeps the name `chatlium-platform`.
