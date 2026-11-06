# Chatlium: Greenfield Decision Record

Chatlium is being built from scratch. No existing code is preserved, so decisions are made for the target system alone, not to protect earlier work. This record supersedes the decisions in the architecture baseline, the usage addendum, and the production stack document where they conflict.

Status: **Decided** unless marked **Verify** (confirm against current docs before pinning).

---

## 1. Scope

**In scope**
- Embeddable website chat widget
- Workspaces, membership, and roles
- Knowledge base: upload, extraction, chunking, embeddings, vector search
- AI answers with a platform-managed model key
- Escalation to a human, with an operator inbox and conversation history
- Simple workflow: a fixed default graph plus a basic editor for node order and conditions
- Execution history and per-run usage (tokens, estimated cost, trace link)
- AWS platform: Terraform, EKS, GitOps, security controls, observability, load and failure testing

**Out of scope**
- Billing, credits, invoicing
- BYOK (tenant-supplied model keys)
- WhatsApp, Instagram, Facebook, and other channels
- Operator replies from the inbox (roadmap)
- Visual canvas beyond the simple editor
- Multi-region deployment
- A separate Python or FastAPI service

Design the message model and the provider interface so these can be added later without restructuring.

---

## 2. Decisions

| Area | Decision | Reason |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language and shared types across web, workers, widget, and packages |
| Runtime | Node.js current LTS | Pinned in `.nvmrc` and in images |
| Monorepo | pnpm workspaces + Turborepo | Dependency-aware builds and caching |
| Web app and API | Next.js (App Router) with Route Handlers | One deployable for dashboard and synchronous API |
| Widget | Separate Vite build, versioned, delivered as static assets from S3 through CloudFront | Customers embed a stable script that doesn't depend on Next.js. Teaches static delivery at the edge |
| Widget isolation | Shadow DOM, plus a sandboxed test host page in CI | Prevents CSS and script conflicts with host sites |
| Authentication | **Amazon Cognito** user pool, OIDC authorization code flow with PKCE, tokens exchanged and validated server-side | Managed MFA, account recovery, password policy and brute-force protection, so you don't own that security code. Decided after comparing with Better Auth (see amendments section 2) |
| Authorization | Workspace membership and roles checked in application code on every protected operation, plus Postgres row-level security | Authentication alone never grants workspace access |
| Session handling | Server-side sealed session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`. No tokens in browser storage. Origin check plus CSRF protection on state-changing requests. Access tokens 15 minutes, refreshed on the server | Cognito does not manage the app's browser session, so the app must protect it |
| Widget authentication | Separate, short-lived signed token scoped to one widget and one origin | Public widget identity must not share the dashboard session model |
| Database | PostgreSQL (current supported major) with pgvector | Relational data, vectors, and RLS in one system |
| Database access | Drizzle ORM and drizzle-kit | Type-safe queries and reviewed migrations |
| Database roles | Application connects as a non-superuser role without `BYPASSRLS` | Otherwise RLS is bypassed silently |
| Cache and rate limits | Redis (ElastiCache in AWS, container locally) | Rate limits, abuse counters, Centrifugo engine. Never authoritative |
| Queue | Amazon SQS: FIFO for chat (group = conversation ID), Standard for indexing, dead-letter queues for both | Managed, scales with KEDA. Behind a `MessageQueue` interface |
| Local queue | Floci (verified for FIFO and DLQs). Unit tests use an in-process `MessageQueue` adapter. Integration and contract tests use the real SQS adapter against Floci | Keeps local development off the cloud. **Verify** FIFO support in the chosen emulator before relying on ordering tests |
| Event reliability | Transactional outbox, at-least-once publishing, idempotent consumers keyed by `job_id` with a unique constraint on `processed_messages` | Exactly-once business effects, not exactly-once delivery |
| Realtime | Centrifugo (self-hosted), behind the ALB with WebSocket paths | Workers are separate processes and need a fan-out layer to reach browsers. Centrifugo handles connection scaling and channel auth |
| Object storage | Amazon S3, SSE-KMS encryption, versioning on, lifecycle rules | Document originals and widget assets |
| Encryption | KMS for S3, RDS, and Secrets Manager encryption | No application-level envelope encryption, since BYOK is out of scope |
| Secrets | AWS Secrets Manager, synced into Kubernetes by External Secrets Operator | Platform Gemini key and database credentials never touch the repo or the browser |
| AI | Vercel AI SDK behind an `LLMProvider` interface, Gemini adapter first | Provider can change without touching the workflow engine |
| Model key | Platform key only | Greenfield with BYOK out of scope |
| Embeddings | One embedding model per deployment, recorded on each document and each chunk batch | Vectors from different models are not comparable |
| Workflow engine | Custom executor in TypeScript | Node set is small and fixed. Owning the executor shows the reliability work directly |
| Workflow alternatives considered | Temporal: strong durable execution, but operating its server is a separate project and costs more than the budget. LangGraph: useful for approval gates, but its checkpoints would duplicate the execution records | Both rejected for the portfolio version |
| Escalation | Single owner: only the Action node changes conversation status. Tools set flags but never write | Prevents duplicate escalations |
| Validation | Zod at every boundary, schemas shared between API, workers, and widget | One source of truth for shapes |
| Logging | Pino, structured JSON, correlation IDs | Machine-readable logs with trace linkage |
| Tracing and metrics | OpenTelemetry SDK → Collector → Tempo (traces) and Prometheus (metrics) | Standard, vendor-neutral instrumentation |
| Logs in AWS | CloudWatch Logs | Managed, no extra stateful component |
| Dashboards | Grafana | Operational dashboards and cost panels |
| Usage and cost | PostgreSQL tables (`llm_calls`, `embedding_calls`, rollups on runs and conversations) | Authoritative per-run cost. Prometheus holds aggregates only |
| Telemetry rules | Allowlisted fields only in spans and logs. No prompts, tool payloads, keys, or personal data | Prevents leaking customer data into observability systems |
| Infrastructure | Terraform with S3 remote state and native S3 locking (`use_lockfile = true`) | **Verify** the minimum Terraform version that supports it |
| Kubernetes | EKS, Helm charts, Argo CD for GitOps | Declarative, reviewable deployments |
| Scaling | HPA (web), KEDA (workers on SQS depth), Karpenter (nodes) | Three scaling layers, each demonstrable |
| Policy | Kyverno admission policies | Enforces security baseline at deploy time |
| CI/CD | GitHub Actions with OIDC to AWS, Trivy scans, images deployed by digest | No long-lived AWS keys |
| Testing | Vitest (unit and integration), Testcontainers (real Postgres and Redis), Playwright (end to end), k6 (load) | Real dependencies in integration tests |
| Dependency updates | Renovate, with grouped weekly updates | Keeps the stack current without manual tracking |

---

## 3. Architecture summary

**Request path:** browser or widget → CloudFront (WAF on the widget path) → ALB → Next.js (dashboard, API) or Centrifugo (WebSocket). Widget static assets come from S3 through CloudFront.

**Message path:** visitor message → API validates the widget token, origin, size, and rate limit → one transaction writes the message and an outbox event → dispatcher publishes to SQS FIFO → chat worker consumes, checks `processed_messages`, runs the workflow → retrieval, LLM call, condition, action → result written in one transaction → events published to Centrifugo → browser receives tokens and the final message.

**Indexing path:** upload request → presigned S3 URL → client uploads → confirm → outbox → SQS Standard → indexing worker extracts, chunks, embeds, writes chunks and vectors, records usage.

**Escalation path:** Condition node evaluates → Action node sets status to escalated (once, guarded) → inbox badge via Centrifugo → operator opens history.

**Usage path:** each LLM or embedding call writes one usage row with status, attempt, and idempotency key. Run and conversation totals are computed in the same transaction that finalizes the run. Unknown usage is stored as unknown, not zero.

---

## 4. Data model (core tables)

| Table | Notes |
|---|---|
| `users` | Application user, linked to Cognito by `cognito_sub` (unique). Created on first sign-in |
| `workspaces`, `memberships` | Role per membership. Every query is scoped by workspace |
| `widgets` | Public ID, allowed origins, token settings. The public ID is not a secret |
| `documents` | Status, S3 key, `embedding_model`, `embedding_dims`, deletion state |
| `document_chunks` | Text, metadata, vector, `document_id`, `workspace_id`. HNSW index |
| `conversations` | Status: active or escalated. `visitor_ref` for the widget visitor |
| `messages` | Role, content, `conversation_id`, `workspace_id` |
| `workflows`, `workflow_versions` | Versions are immutable once published |
| `executions`, `execution_steps` | Pinned to a workflow version. Step status, outputs, decisions |
| `outbox_events` | Pending and published state, `event_id` |
| `processed_messages` | `job_id` with unique constraint, for idempotency |
| `llm_calls`, `embedding_calls` | Usage rows, described in section 5 |
| `model_prices` | Versioned price table with effective dates |

Every tenant-owned table has `workspace_id` and an RLS policy from the first migration.

---

## 5. Usage accounting rules

- `llm_calls` columns: `id`, `workspace_id`, `execution_id`, `execution_step_id`, `provider`, `model`, `status` (succeeded, failed, timed_out), `attempt`, `call_index`, `idempotency_key`, `provider_request_id` (nullable), `input_tokens` (nullable), `output_tokens` (nullable), `cost_micros` (nullable), `usage_status` (`reported`: provider returned counts; `estimated`: computed by Chatlium, for example from a tokenizer; `unknown`: not observed, so tokens and cost are null), `price_version`, `duration_ms`, `ttft_ms`, `finish_reason`, `trace_id`, `created_at`.
- `embedding_calls` columns: `id`, `workspace_id`, `purpose` (indexing or query), `execution_id` (nullable, set only for query embeddings), `document_id` (nullable, set only for indexing), `model`, `tokens`, `cost_micros`, `usage_status`, `price_version`, `idempotency_key`, `created_at`.
- Document indexing cost belongs to the document, never to an execution or conversation.
- Query embedding cost and generation cost belong to the execution.
- A retried job creates a new attempt, but never a duplicate row for the same call, because of the idempotency key.
- Costs are integer micro-units. Labeled as estimated in every view.

---

## 6. Telemetry allowlist

Permitted in spans and logs:
- IDs: `workspace_id`, `conversation_id`, `execution_id`, `job_id`, `trace_id`, `document_id` (hashed in metric labels, never used as metric labels)
- Provider, model, node type, status, error category, attempt, duration, token counts
- Sanitized error messages without payload content

Not permitted:
- Prompts, completions, message text, document text, tool inputs or outputs
- Email addresses, phone numbers, names, or any other personal data
- API keys, tokens, cookies, session IDs, or secrets of any kind
- Full URLs with query strings from outbound requests

Metric labels are limited to provider, model, node type, and outcome. Never workspace or run identifiers.

Enforce this with a single logging and telemetry helper that all code uses. Test it by running a sample execution and scanning the emitted spans and logs for forbidden patterns.

---

## 7. Security baseline

- Dashboard sessions: Cognito sign-in, sealed session cookie as above, server-side validation of the ID token (`iss`, `aud`, `exp`, `nonce`, `token_use`) and of the session on every protected route. MFA required for operator and admin accounts by Phase 7.
- Widget: signed token with `workspace_id`, `widget_id`, origin, expiry. Verified on every request. Origin checks are not authentication, since non-browser clients can forge headers.
- Rate limits: per IP, per widget, per conversation. Redis-backed. Basic limits in Phase 1, WAF rules later.
- Input limits: maximum message length, maximum upload size, file type checks by content as well as extension.
- Outbound requests (HTTP action nodes, later): SSRF guard that resolves DNS once and connects to the validated address, blocking private, loopback, link-local, and metadata ranges.
- Containers: non-root, read-only root filesystem where possible, minimal base images, image scanning in CI.
- Kubernetes: Kyverno blocks privileged pods, requires resource limits, and restricts image registries.
- IAM: each workload has its own role with least privilege. Workers can read S3 and write SQS. The web tier cannot read the platform key.
- Terraform state bucket: versioned, encrypted, access restricted.

---

## 8. Reliability rules

- Every event that follows a database change goes through the outbox.
- Consumers check `processed_messages` before side effects, and record completion in the same transaction as the side effect where possible.
- External calls have explicit timeouts. Retries use exponential backoff with jitter and a fixed maximum.
- Failed jobs go to a dead-letter queue after the retry limit. DLQ depth has an alarm.
- Streaming is not completion. A run is complete only when its final state is written. A retried run must not send a second complete answer.
- Graceful shutdown on SIGTERM for every process. Kubernetes grace periods match.

---

## 9. Phase order (greenfield)

Each phase has a time limit to be set by the owner, and a definition of done.

1. **Foundation.** Monorepo, config validation, logger, Postgres with pgvector and RLS in the first migration, Cognito sign-in, workspace membership, CI running lint, types, unit tests, and integration tests with Testcontainers.
2. **Vertical slice.** Upload a document, index it, widget loads, visitor asks, streamed grounded answer, low-confidence escalation to the inbox with history. Usage rows recorded from the first LLM call. Tenant isolation tests in CI.
3. **Containers and local platform.** Dockerfiles, Compose with Postgres, Redis, Floci or ElasticMQ, outbox dispatcher, idempotency tests, widget test host page.
4. **AWS foundation.** Terraform: VPC across three AZs, RDS, ElastiCache, S3 with versioning, SQS with DLQs, ECR, Secrets Manager, KMS, IAM. Remote state with native locking. Restore test from backup.
5. **Kubernetes and delivery.** EKS, Helm, Argo CD, ALB routing for web and WebSocket paths, External Secrets, Kyverno, GitHub Actions with OIDC, image scanning, deployment by digest, rollback by Git revert.
6. **Scaling and reliability.** HPA, KEDA on SQS depth, Karpenter, load test, worker failure test, dependency failure test, node drain test.
7. **Observability and security hardening.** OpenTelemetry traces across the full message path, Prometheus and Grafana dashboards, cost panels, alerts, WAF rules, usage views in the dashboard, telemetry allowlist test, deletion tests.
8. **Simple workflow editor.** Only after the above is working and measured.
9. **Evidence.** README with the cost-optimized demo and the production design clearly separated, runbooks, one written incident, recorded demonstration of the scaling and recovery recipe.

Cut order if time runs short: the workflow editor, then non-essential dashboard views, then extra WAF rules. Do not cut the tests, the failure demonstrations, or the security baseline.

---

## 10. Development and cost model

- Daily development runs locally with Docker Compose: Postgres with pgvector, Redis, local queue emulator, widget test host.
- The AWS environment is created with Terraform only for testing and demonstration, then destroyed.
- Each demonstration records its actual AWS cost.
- Single-AZ database and a single NAT gateway are acceptable for the demo, if labeled. The production design keeps three AZs and is documented as such.

---

## 11. Open items to verify before pinning

| Item | Why it matters |
|---|---|
| Cognito features and pricing in your chosen region, and whether Floci emulates the Cognito features you need | Core of authentication, and local development |
| Local queue emulator FIFO support (Floci or ElasticMQ) | Ordering tests depend on it |
| Minimum Terraform version for native S3 state locking | Backend configuration |
| Vercel AI SDK telemetry options and current version | LLM span instrumentation |
| OpenTelemetry GenAI semantic convention attribute names | Span and metric naming |
| Centrifugo current version and its WebSocket behavior behind the ALB | Realtime path |
| Current EKS, Kubernetes, and Helm versions | Cluster creation |

Verify each item, record the version, and pin it in the lockfile or Terraform configuration.
