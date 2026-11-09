# ADR 0003: Row-level security checks membership when a user is set

- Status: Accepted
- Date: 2026-11-09

## Context

Build guide Step 1.8, test 6: _"A user with a membership in workspace A, but none in B, reads zero rows from B when acting through `withWorkspace(B)`."_

The Step 1.6 policies compared only `workspace_id` with `app.workspace_id`. The database never knew who was asking, so `withWorkspace(B)` exposed B's rows to anyone, and test 6 could not pass. Membership was checked only in application code (`requireWorkspaceRole`, Step 1.12).

A blanket membership requirement would break workers. They act on a workspace from a validated job with no user (amendments §4).

## Decision

The owner chose a second, database-level layer (2026-11-09):

1. `withWorkspace(db, { workspaceId, userId? }, fn)` replaces `withWorkspace(db, workspaceId, fn)`. Web requests pass the acting user. Workers omit it.
2. Migration `0002_membership_aware_rls.sql` changes the tenant policies on `documents` and `conversations` to:
   `workspace_id = app.workspace_id AND (app.user_id IS NULL OR EXISTS (membership of app.user_id in app.workspace_id))`, for both `USING` and `WITH CHECK`.
3. `memberships` cannot check membership in its own policy: PostgreSQL rejects self-referencing policies as infinite recursion. Its workspace-wide policy (`membership_write`) now applies only when **no user** is set, a system context. A user always sees their own rows through `own_memberships`. Listing or changing all members of a workspace is therefore a system operation, reached only after the application's role check.
4. Every future tenant table uses the same membership-aware policy shape.

## Consequences

- A web request that passes a wrong workspace ID cannot read or write another tenant's rows, even if an application-level check is missing or buggy. Application checks (Step 1.12) remain the first layer.
- The `EXISTS` subquery does not depend on the row, so PostgreSQL evaluates it once per query (an InitPlan) using the `(workspace_id, user_id)` unique index.
- The settings are still client-controlled: code holding the app role could set any user. This layer protects against bugs, not against compromised application code.
- `scripts/isolation-proof.ts` weakens each policy in turn and confirms its test fails. Only test 6 catches a "workspace only, no membership" policy.
