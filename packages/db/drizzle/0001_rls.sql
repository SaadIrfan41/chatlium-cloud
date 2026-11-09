-- Row-level security for tenant-owned tables (build guide Step 1.6, amendments §4).
--
-- Context is set per transaction with set_config(..., true) by withWorkspace / withUser (Step 1.7).
-- nullif(current_setting(name, true), '') turns an unset or empty setting into NULL, so the
-- comparison is NULL and the policy returns no rows: it fails closed instead of raising a cast error.
--
-- FORCE makes the policies apply to the table owner (chatlium_owner) too. Without FORCE, the
-- owner bypasses RLS.

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Tenant policy: rows are visible and writable only inside their own workspace context.
CREATE POLICY "tenant_isolation" ON "documents"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "conversations"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

-- Membership lookup before a workspace is chosen: a user reads only their own rows (amendments §4).
CREATE POLICY "own_memberships" ON "memberships"
  FOR SELECT
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint

-- Inside a workspace context: memberships of that workspace only, for reads and writes.
CREATE POLICY "membership_write" ON "memberships"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
