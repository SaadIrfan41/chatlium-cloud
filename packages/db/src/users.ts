import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from './schema.ts';

export interface CognitoIdentity {
  readonly cognitoSub: string;
  readonly email: string;
}

/**
 * Returns the application user ID for a Cognito identity, creating the user on first sign-in
 * (build guide 1.11). Later sign-ins keep the same ID and refresh the email, which can change in
 * Cognito while `sub` cannot. `users` is not tenant-scoped, so no workspace context is needed.
 */
export async function upsertUserByCognitoSub(
  db: NodePgDatabase,
  identity: CognitoIdentity,
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ cognitoSub: identity.cognitoSub, email: identity.email })
    .onConflictDoUpdate({ target: users.cognitoSub, set: { email: sql`excluded.email` } })
    .returning({ id: users.id });
  if (row === undefined) {
    throw new Error('user upsert returned no row');
  }
  return row.id;
}
