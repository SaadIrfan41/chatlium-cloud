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

## 12. Next step

Start the repository with the monorepo, config, and the database migration with RLS. Write the isolation tests before the features that use them. Then add Cognito sign-in, membership checks, and CI. Do not create every package in the proposed architecture at once; create packages when the phase needs them.
