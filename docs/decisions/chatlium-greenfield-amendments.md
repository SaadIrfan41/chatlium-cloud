# Chatlium Greenfield: Amendments

This file amends `chatlium-greenfield-decisions.md`. Where the two differ, this file wins. The stack itself is unchanged.

---

## 1. Verification status

These items were reviewed against current documentation. Record the version you actually pin, and re-check each item at pinning time.

| Item | Status | Action |
|---|---|---|
| Cognito | Chosen over Better Auth (section 2) | Verify current features, pricing, and Floci's Cognito support. If Floci doesn't cover what you need, use a development user pool in the test AWS account |
| Floci SQS | Reviewed. Reported to support Standard and FIFO queues, DLQs, and visibility timeouts | Run the contract tests in section 3 before relying on it |
| ElasticMQ | Reported to support FIFO via `fifo = true` | Valid fallback if Floci fails the contract tests |
| Terraform S3 native locking | Reported as introduced in Terraform 1.10 | Set `required_version >= 1.10.0`. Grant the state role permission on the `.tflock` object, including delete |
| Vercel AI SDK telemetry | Reported as experimental, and recording inputs and outputs by default | Disable input and output recording explicitly. Treat as supplementary tracing |
| GenAI conventions | Reported as moved to a separate repository, with renamed attributes | Pin the convention version. Verify attribute names before instrumenting |
| Centrifugo behind ALB | Reported as supported, with the configuration in section 5 | Pin the Centrifugo release in Phase 5 |
| EKS and Helm | Reported: EKS standard support for Kubernetes 1.34 through 1.37, Helm 4 current stable | Start on Kubernetes 1.36, validate Karpenter, KEDA, and Argo CD on it, and use Helm 4 if your tooling supports it |

---

## 2. Authentication and CSRF

Replace the earlier wording on CSRF:

> Previously: "CSRF tokens on state-changing requests."

> Now: Authentication uses Amazon Cognito, not Better Auth. Cognito handles sign-in, MFA, recovery and brute-force protection, but not the application's browser session, so the application owns it:
> - A sealed session cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`. No tokens in `localStorage` or `sessionStorage`.
> - The OIDC flow uses PKCE, `state` and `nonce`, with the code exchanged on the server.
> - State-changing requests require a matching `Origin` header from the trusted list, plus a CSRF token (double-submit or synchronizer pattern). `SameSite=Lax` alone is not relied on.
> - Access tokens last 15 minutes and are refreshed on the server. Global sign-out is used for account compromise or member removal.
>
> Why Cognito: it removes authentication security code you would otherwise own and patch. The cost is AWS coupling and slower revocation, which short token lifetimes and global sign-out cover.

Authorization remains in application code. Every protected operation checks workspace membership and role after authentication. Authentication alone never grants workspace access.

---

## 3. Queue contract tests

Emulator support for FIFO is not the same as AWS behavior. Before the production demonstration, run one contract test suite against both the local emulator and real SQS in a test account. The suite must cover:

1. Message group ordering: messages in one group are processed in order.
2. Concurrency across groups: two consumers process different groups at the same time.
3. Deduplication: a duplicate send within the deduplication window is handled as specified.
4. Visibility timeout and redelivery: an unacknowledged message reappears after the timeout.
5. Dead-letter movement: a message exceeding the receive limit lands in the DLQ.
6. Consumer crash and recovery: a killed consumer's in-flight message is processed after recovery, and the idempotency check prevents a duplicate side effect.

Run the suite on every change to the queue adapter. Publish the results in the README.

---

## 4. Tenant context in PostgreSQL

Every tenant-scoped database operation runs inside a transaction that sets the workspace context locally:

```sql
BEGIN;
SET LOCAL app.workspace_id = '<workspace-uuid>';
-- tenant-scoped queries here
COMMIT;
```

Application sequence for a web request:
1. Authenticate the user through the Cognito-backed session.
2. Verify the user's membership in the requested workspace.
3. Open a transaction.
4. Set `app.workspace_id` with `SET LOCAL`.
5. Run tenant-scoped queries.
6. Commit, or roll back on error.

Rules:
- Use `SET LOCAL`, never a session-level `SET`. Pooled connections are reused across requests, and a session setting would leak tenant context to the next request.
- RLS policies read the setting with `current_setting('app.workspace_id', true)`. If it is missing, the expression returns null and the policy returns no rows. This makes the default fail closed.
- Tenant tables use `FORCE ROW LEVEL SECURITY`.
- The application role is not a superuser and does not have `BYPASSRLS`.

**Membership lookup needs its own path.** To verify membership, the application must read the user's memberships before any workspace context exists. Put memberships behind a policy that allows a user to read only their own rows, keyed on the authenticated user ID rather than the workspace context. Test that this policy cannot be used to read other users' memberships.

**Workers need the same discipline.** A job carries a workspace ID that was validated at ingestion. The worker sets `app.workspace_id` from that job at the start of each transaction, and does not rely on the process having any ambient context.

---

## 5. Widget delivery

Split the widget into a stable loader and versioned assets.

```
Customer website
   │  <script src="https://cdn.example.com/widget.js" data-widget-id="...">
   ▼
CloudFront
   ├── /widget.js                 stable loader, short cache lifetime
   └── /widget/v1.0.0/*.js, css   versioned bundle, immutable cache headers
```

Rules:
- The loader is small, stable, and changes rarely. It reads the widget ID from its script tag, then loads the versioned bundle that the widget's configuration names.
- Versioned bundles are never overwritten. Immutable cache headers apply.
- Roll out new versions by changing the widget's configured version, not by replacing files.
- CORS headers are set for the asset paths. If the bundle uses ES modules, load it with the correct module type and verify the headers in a test.
- The widget ID is an identifier, not a secret. Security comes from the server-side checks in section 7.

---

## 6. Centrifugo authorization model

Centrifugo must not become an unauthorized route to tenant data.

**Channels**
- Visitor channel: one per conversation. Subscribable only by the visitor who owns that conversation.
- Operator channel: one per workspace, for the live inbox. Subscribable only by members of that workspace with an operator role.

**Tokens**
- The Next.js API issues short-lived connection tokens and subscription tokens. Tokens are signed, scoped to specific channels, and expire quickly.
- Visitor subscription tokens are issued only after the widget token and conversation ownership are verified.
- Operator subscription tokens are issued only after session validation and workspace membership and role checks.
- Channel names are not authorization. An unguessable identifier is still checked by the token.

**Publishing**
- Workers and the API publish through Centrifugo's server-side API, using a server credential held only by server components.
- Browsers never receive a credential that can publish.
- Message payloads sent to channels follow the telemetry-style allowlist: no more than the UI needs, and no fields from other conversations.

**Tests**
- A visitor token for conversation A cannot subscribe to conversation B.
- A dashboard member of workspace A cannot subscribe to workspace B's operator channel.
- An expired subscription token is refused.
- A browser cannot publish to any channel.

---

## 7. Widget security

Basic controls land in Phase 1. Each control has a test.

| Control | Test |
|---|---|
| Signed, short-lived widget token scoped to widget, workspace, and origin | Expired token refused. Token for widget A refused on widget B |
| Origin allowlist | Request from a non-allowlisted origin refused |
| Payload size limit | Oversized body refused before parsing |
| Basic per-IP and per-widget rate limit | Limit triggers at the configured threshold and clears after the window |

Origin checks are not authentication. Non-browser clients can forge the `Origin` header, which is why the signed token is the actual control.

---

## 8. Usage accounting across retries

A queue redelivery and a provider retry are different things.

- A queue redelivery re-runs the job. It does not by itself mean a new provider request.
- A provider retry is a new external request, with its own cost.

Rules:
- Record every actual provider request as its own row in `llm_calls` or `embedding_calls`. Each row has its own attempt number and call identifier.
- The idempotency key identifies the logical call within a job. A redelivered job that finds an existing row for a call reuses that row rather than creating a new one.
- If a worker crashes after the provider processes a request but before the usage row is persisted, the row is written as `usage_status = unknown` when the job is recovered, if the provider request ID can be recovered. If it cannot, record the call as unknown. Never record an unobserved request as zero cost.
- Unknown usage is shown in the dashboard as unknown, with a count, so totals are understood as lower bounds where applicable.

---

## 9. Telemetry settings

Apply these to every Vercel AI SDK call:

```ts
experimental_telemetry: {
  isEnabled: true,
  recordInputs: false,
  recordOutputs: false,
}
```

Also add a span processor that drops any attribute not on the allowlist from the telemetry specification. This enforces the rule in code rather than relying on each call site.

Architecture rule: your own execution spans and usage records are the primary source of truth for runs and cost. SDK-generated spans are supplementary. If they conflict with your records, your records win.

Pin the GenAI attribute names to a specific convention version in a single constants module. Use the current names (for example, `gen_ai.provider.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.request.model`, `gen_ai.response.finish_reasons`). Keep a note of the version in the module header, so an upgrade is a deliberate change.

---

## 10. Centrifugo behind the ALB

- The ALB listener forwards WebSocket upgrades to Centrifugo. Preserve the `Upgrade` and `Connection` headers, and use HTTP/1.1 for the upgrade.
- Set the ALB idle timeout comfortably above Centrifugo's ping interval. Centrifugo's default is 25 seconds, so a timeout of several minutes is a safe starting point, verified in testing.
- Route WebSocket paths to Centrifugo. Route all other paths to Next.js.
- Turn off CloudFront caching for authenticated and WebSocket paths.
- Test a full connection, a dropped connection, and a reconnect through the ALB before Phase 5 is complete.

---

## 11. Updated Phase 1 scope

The first working milestone adds these items to the foundation:

- Monorepo, config validation, logger
- Drizzle schema and the first migration, including tenant tables, RLS policies, `FORCE ROW LEVEL SECURITY`, and the membership policy from section 4
- Non-superuser application role
- Cognito sign-in (OIDC with PKCE) and a sealed server-side session cookie
- Membership and role checks, with tests that a user cannot read another workspace's data
- CI: lint, type-check, unit tests, and integration tests with Testcontainers

Widget, queue, workers, and realtime start in later phases, as already planned.

---

## 12. Retrieval quality (added 2026-11-10)

The guide's Phase 2 retrieval is a baseline: recursive chunks, vector-only search, the raw visitor message as the query, and escalation on a similarity threshold. That baseline misses exact identifiers (order numbers, error codes, product codes), retrieves poorly for follow-up questions, and has no measurement behind its threshold. These five changes fix that inside the existing design. They add no new service or model provider, and they keep every query tenant-scoped under RLS.

The ideas come from a study of a multi-lab RAG course (`docs/research/2026-11-10-advanced-rag-labs-guide.md`). They are adopted as ideas. No course code is copied.

### 12.1 Hybrid search (Step 2.6)

Step 2.6 becomes **hybrid search with tenant scope**.

- `document_chunks` gets a generated full-text column, `search_text tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED`, with a GIN index. Use the `simple` configuration so identifiers and product names are not stemmed. **Verify** in a test how the parser tokenizes identifiers like `ORD-1234` and `NX-742-A`, and add a normalized form if they do not match reliably.
- `search(workspaceId, queryText, { topK, minScore })` runs two candidate searches in **one SQL statement** inside `withWorkspace`: vector (cosine distance on the HNSW index) and full-text (`ts_rank_cd` over an OR of the query's lexemes). Both take 20 candidates and apply the same filters: workspace, `ready` documents, and the recorded embedding model.
- Merge the two lists with Reciprocal Rank Fusion, `score = Σ 1 / (60 + rank)`, deduplicated by chunk ID. The candidate depth (20) and the RRF constant (60) are named constants.
- Output, per chunk: text, document ID, chunk ID, fused rank, cosine similarity, and whether it matched the full-text search. The Knowledge node output becomes `{ chunks, topVectorScore, lexicalHit }`. RRF scores are not comparable across queries, so they never feed the escalation rule.

Tests, in addition to the guide's three:
- An exact identifier present in one chunk ranks that chunk first, even when its vector score is not the highest.
- A paraphrase with no shared words still finds the right chunk through the vector side.
- A chunk found by both sides appears once.
- A full-text match in workspace B never appears for workspace A.

### 12.2 Standalone query rewrite for follow-ups (Step 2.10)

A chat message like "and what about the second one?" is a poor search query. Before retrieval, the chat worker rewrites the message into one standalone question, **only when the conversation already has earlier messages**.

- One structured-output call to the configured Gemini model (`generateObject` or its current equivalent in the Vercel AI SDK, **verify** the name), with a short timeout and temperature 0. It returns `{ standaloneQuery }`.
- **Intent guard.** Before the call, extract from the current message the identifiers, numbers, quoted phrases and dates, using deterministic patterns. If the rewrite drops any of them, discard it and search with the original message. Also fall back to the original message on timeout or invalid output. Record the fallback reason on the execution step.
- The rewrite is used **only for retrieval**. The LLM node still receives the visitor's original message and the history. The rewrite never appears in the answer, the evidence, or logs. Record its length and outcome only.
- The call is recorded in `llm_calls` like any other LLM call, so it shows in usage and cost.

Tests: a follow-up with a pronoun is rewritten; a rewrite that drops an identifier is rejected and the original is used; a first message is never rewritten; a provider failure falls back without failing the message.

### 12.3 Citations by chunk, checked in code (Steps 2.9 and 2.10)

- The LLM prompt lists the retrieved chunks with short labels, `[1]` to `[n]`. The server keeps the label-to-chunk-ID map. Raw IDs never go to the model.
- The system prompt requires a label after each supported statement, and a fixed escalation-style reply when the chunks do not contain the answer.
- When the stream completes, the worker parses the labels and keeps only those it supplied. It stores the cited chunk IDs with the assistant message in a `message_citations` table (`message_id`, `chunk_id`, `workspace_id`; RLS like every tenant table), and records a grounding status on the execution: `cited` or `uncited`. A label the server did not supply is dropped and counted.
- **Number check.** Every number in the final answer must appear in at least one cited chunk. Otherwise, record the flag `unsupported_number` on the execution.
- Tokens are already on the visitor's screen when these checks run, so the checks do not block the stream. They govern what is stored, what the operator sees in the run detail, and what the evaluation counts. Showing source titles to visitors is a per-workspace setting for Phase 7, off by default, because document titles may be internal.

Tests: a supplied label is stored as a citation; an invented label is dropped; an answer with a number that is absent from the chunks is flagged.

### 12.4 Golden set and retrieval metrics (new, between Steps 2.6 and 2.12)

Add `packages/knowledge/eval`. The escalation threshold in Step 2.12 must be set from this harness, not by guessing.

- **Corpus.** A small set of synthetic markdown support documents written for this repository, with refunds, shipping, accounts, product codes and error codes.
- **Cases.** At least 25 JSONL cases, each tagged: `exact_identifier`, `paraphrase`, `follow_up` (with prior turns), `multi_part`, and `unanswerable` (expected to escalate). Chunk IDs are random UUIDs, so a case names its relevant evidence by fixture document plus a text snippet the relevant chunk must contain.
- **Metrics.** For answerable cases: Hit@K, Recall@K, MRR and nDCG@K. For all cases: escalation accuracy (escalated exactly when expected).
- **No API key in CI.** Embeddings for the fixture corpus and the queries are committed as a fixture file, keyed by model, dimensions and text hash. A refresh script, run by hand with a key, regenerates it. Everything else runs offline.
- **Gate.** The committed baseline metrics are the floor. CI fails if any metric drops by more than a stated tolerance. A failing case can be pinned as a named regression test.
- **Comparison.** The harness runs vector-only and hybrid on the same cases and writes both to the build log. Each later retrieval change must show its effect here.
- **The escalation ADR in Step 2.12** records the chosen rule and threshold with the metrics that justify them. Starting rule to test: escalate when `topVectorScore` is below the threshold **and** there is no full-text hit, or when the visitor asks for a person.

Answer-quality judging with an LLM is optional and not part of CI.

### 12.5 Heading-aware chunking and content-hash reuse (Steps 2.4 and 2.5)

- **Chunking.** For markdown, a heading starts a new chunk, and each chunk records its heading path (for example `Refunds > Timelines`). The heading path is prepended to the text that is embedded and full-text indexed, but not to the text shown as evidence. Long sections are still split by the guide's recursive splitter. PDFs and plain text use the recursive splitter alone. Chunking stays deterministic.
- **Reuse.** Store `content_hash` (SHA-256 of the extracted, normalized text) on `documents`. If a `ready` document **in the same workspace** has the same hash and embedding model, copy its chunks and vectors instead of calling the embedding API, and record that no embedding call was made. Never reuse across workspaces: a cost or timing difference would reveal that another tenant holds the same document.

Tests: markdown headings produce one chunk per section with its path; the same input always produces the same chunks; re-uploading identical content in the same workspace makes no embedding call; the same content in another workspace is embedded separately.

### 12.6 Considered and not adopted (for now)

Each item can return later, but only with evidence from the 12.4 harness that it fixes failing cases:

- **Cross-encoder reranking.** It gave the largest gain after hybrid search in the course study, but it needs either a model server or a hosted reranker. Revisit after Phase 3 if the harness shows good chunks ranking below Top-K.
- **Grading the context before generating.** A cheap way to make escalation smarter. Revisit if the threshold rule misclassifies cases in the harness.
- **HyDE, multi-query and query decomposition.** Each adds model calls and latency to every chat message.
- **Self-correcting answer loops.** Verifying after generation does not fit streamed answers, because the visitor has already seen the text.
- **GraphRAG, and OCR for scanned PDFs.** Large maintenance cost for support content. Step 2.3 already rejects PDFs without a text layer.

---

## 13. Next step

Start the repository with the monorepo, config, and the database migration with RLS. Write the isolation tests before the features that use them. Then add Cognito sign-in, membership checks, and CI. Do not create every package in the proposed architecture at once; create packages when the phase needs them.
