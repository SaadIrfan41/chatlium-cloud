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

/**
 * Runs `fn` inside a transaction whose row-level security context is one workspace.
 *
 * The context is set with `set_config('app.workspace_id', $1, true)`: a bind parameter (SET LOCAL
 * cannot take one, so string interpolation would be an injection path), and transaction-local
 * (`true`), so it ends with the transaction and cannot leak to the next request on a pooled
 * connection. Callers must check membership first (requireWorkspaceRole, Step 1.12).
 */
export async function withWorkspace<T>(
  db: NodePgDatabase,
  workspaceId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const id = requireUuid(workspaceId, 'workspace');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${id}, true)`);
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
