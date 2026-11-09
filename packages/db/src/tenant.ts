import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

/** The transaction handle passed to the callbacks of withWorkspace and withUser. */
export type TenantTransaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/** Thrown before any SQL runs when a workspace or user ID is not a UUID. */
export class InvalidTenantIdError extends Error {
  constructor(kind: 'workspace' | 'user') {
    super(`Invalid ${kind} ID: expected a UUID`);
    this.name = 'InvalidTenantIdError';
  }
}

const uuidSchema = z.uuid();

function requireUuid(value: string, kind: 'workspace' | 'user'): string {
  if (!uuidSchema.safeParse(value).success) {
    throw new InvalidTenantIdError(kind);
  }
  return value;
}

export interface WorkspaceContext {
  readonly workspaceId: string;
  /**
   * The acting user. Web requests always pass it: row-level security then also requires that
   * user to be a member of the workspace (ADR 0003). Workers omit it, because a job carries a
   * workspace validated at ingestion but no user (amendments §4).
   */
  readonly userId?: string;
}

/**
 * Runs `fn` inside a transaction whose row-level security context is one workspace, and
 * optionally the acting user.
 *
 * The context is set with `set_config(name, $1, true)`: a bind parameter (SET LOCAL cannot take
 * one, so string interpolation would be an injection path), and transaction-local (`true`), so it
 * ends with the transaction and cannot leak to the next request on a pooled connection.
 * Callers still check membership and role in application code first (requireWorkspaceRole,
 * Step 1.12); the database check is the second layer.
 */
export async function withWorkspace<T>(
  db: NodePgDatabase,
  context: WorkspaceContext,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const workspaceId = requireUuid(context.workspaceId, 'workspace');
  const userId = context.userId === undefined ? undefined : requireUuid(context.userId, 'user');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    if (userId !== undefined) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Runs `fn` inside a transaction whose context is only the authenticated user.
 * Used to read the user's own memberships before a workspace is chosen (amendments §4).
 */
export async function withUser<T>(
  db: NodePgDatabase,
  userId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const id = requireUuid(userId, 'user');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${id}, true)`);
    return fn(tx);
  });
}
