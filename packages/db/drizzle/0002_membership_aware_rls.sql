-- Membership-aware row-level security (ADR 0003, build guide Step 1.8 test 6).
--
-- 0001 checked only the workspace. Now, when a request also carries a user (app.user_id), the
-- database additionally requires that user to be a member of the workspace. Workers act on a
-- workspace with no user (amendments §4), so "no user set" keeps the workspace-only rule.
-- A wrong workspace ID passed by a web request therefore cannot expose another tenant's rows,
-- even if an application-level membership check is missing.

DROP POLICY "tenant_isolation" ON "documents";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND (
      nullif(current_setting('app.user_id', true), '') IS NULL
      OR EXISTS (
        SELECT 1 FROM "memberships" m
         WHERE m."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
           AND m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND (
      nullif(current_setting('app.user_id', true), '') IS NULL
      OR EXISTS (
        SELECT 1 FROM "memberships" m
         WHERE m."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
           AND m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
      )
    )
  );--> statement-breakpoint

DROP POLICY "tenant_isolation" ON "conversations";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversations"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND (
      nullif(current_setting('app.user_id', true), '') IS NULL
      OR EXISTS (
        SELECT 1 FROM "memberships" m
         WHERE m."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
           AND m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
      )
    )
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND (
      nullif(current_setting('app.user_id', true), '') IS NULL
      OR EXISTS (
        SELECT 1 FROM "memberships" m
         WHERE m."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
           AND m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
      )
    )
  );--> statement-breakpoint

-- memberships cannot check membership in its own policy (PostgreSQL rejects self-referencing
-- policies as infinite recursion). Instead, the workspace-wide view of memberships is limited to
-- system contexts with no user. A user always sees their own rows through own_memberships.
DROP POLICY "membership_write" ON "memberships";--> statement-breakpoint
CREATE POLICY "membership_write" ON "memberships"
  USING (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND nullif(current_setting('app.user_id', true), '') IS NULL
  )
  WITH CHECK (
    "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
    AND nullif(current_setting('app.user_id', true), '') IS NULL
  );
