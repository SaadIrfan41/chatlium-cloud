# ADR 0002: Database roles are bootstrapped by an administrator, and the driver is node-postgres

- Status: Accepted
- Date: 2026-11-07

## Context

Build guide Step 1.5 asks for two roles, `chatlium_owner` (owns the schema, runs migrations) and `chatlium_app` (the application, not a superuser, no `BYPASSRLS`), "managed by the migration".

PostgreSQL only lets a role with `CREATEROLE` create other roles. In practice that means the local superuser, or the RDS master user (`rds_superuser`). Migrations run as `chatlium_owner`. Giving the owner `CREATEROLE` would let it create a role with `BYPASSRLS`, which defeats tenant isolation.

## Decision

1. **Roles are created by a bootstrap step, not by a Drizzle migration.** `bootstrapRoles()` in `packages/db/src/roles.ts` runs as the administrator (`pnpm --filter @chatlium/db db:bootstrap`). It is idempotent: it creates the roles or resets their attributes and passwords, so drift such as someone granting `BYPASSRLS` is corrected on the next run. It:
   - creates both roles with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`, plus `NOBYPASSRLS` for the app role;
   - creates the `vector` extension (needs elevated rights);
   - revokes `CONNECT` and `TEMPORARY` on the database from `PUBLIC` and grants `CONNECT` to the two roles only;
   - makes `chatlium_owner` the owner of schema `public`, and grants `chatlium_app` `USAGE` only;
   - creates schema `drizzle` (migration history) owned by `chatlium_owner`, with no access for anyone else, so the app cannot read or tamper with migration records;
   - grants `chatlium_owner` `CREATE` on the database. Drizzle's migrator always runs `CREATE SCHEMA IF NOT EXISTS "drizzle"`, and PostgreSQL checks the privilege before it checks existence. `CREATE` on a database allows creating schemas only, not roles (added in Step 1.6);
   - sets default privileges so that tables and sequences the owner creates later give the app `SELECT, INSERT, UPDATE, DELETE` and `USAGE, SELECT` on sequences, and nothing else (no `TRUNCATE`, `REFERENCES`, `TRIGGER` or DDL).
2. **Migrations run as `chatlium_owner`.** They create tables, RLS policies and `FORCE ROW LEVEL SECURITY` (Step 1.6).
3. **Three separate connection URLs**: `DATABASE_ADMIN_URL` (bootstrap only), `DATABASE_OWNER_URL` (migrations only) and `DATABASE_URL` (`chatlium_app`, the only one application processes receive). Admin and owner URLs are read by `packages/db/scripts/env.ts`, never by `@chatlium/config`.
4. **Driver: node-postgres (`pg` 8.23.1)** with Drizzle's `node-postgres` adapter. It is the most widely deployed Postgres driver for Node, supports pooling and transaction-scoped `set_config`, and works with RDS IAM authentication later.
5. **Install scripts are denied by default** (`allowBuilds` in `pnpm-workspace.yaml`). `esbuild`, `ssh2`, `cpu-features` and `protobufjs` are denied, and drizzle-kit and Testcontainers were verified to work without them.

## Consequences

- Every new environment (local, CI and each AWS database) needs one bootstrap run with administrator credentials before migrations. In AWS this becomes a one-off Job in Phase 5.
- The integration test (`packages/db/test/integration/roles.test.ts`) runs the same `bootstrapRoles()` against a fresh PostgreSQL 18 container, and checks the role flags, DML-only privileges, refused DDL, refused connections for other roles, and drift correction.
- Statements are built server-side with `format(%I, %L)` and bind parameters, so role names and passwords are never concatenated into SQL.
