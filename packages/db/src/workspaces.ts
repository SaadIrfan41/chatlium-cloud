import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { documents, memberships, workspaces, type membershipRole } from './schema.ts';
import { withUser, withWorkspace } from './tenant.ts';

export type MembershipRole = (typeof membershipRole.enumValues)[number];

export interface UserWorkspace {
  readonly id: string;
  readonly name: string;
  readonly role: MembershipRole;
}

/**
 * The workspaces the user belongs to, with their role in each. Runs with only the user in
 * context, so the own_memberships policy limits the rows to the user's own memberships.
 */
export async function listUserWorkspaces(
  db: NodePgDatabase,
  userId: string,
): Promise<UserWorkspace[]> {
  return withUser(db, userId, (tx) =>
    tx
      .select({ id: workspaces.id, name: workspaces.name, role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .orderBy(asc(workspaces.name), asc(workspaces.id)),
  );
}

/**
 * The user's role in one workspace, or undefined when there is no membership. A workspace that
 * does not exist also returns undefined: the two cases are indistinguishable by design.
 * `workspaceId` must already be a valid UUID.
 */
export async function findMembershipRole(
  db: NodePgDatabase,
  userId: string,
  workspaceId: string,
): Promise<MembershipRole | undefined> {
  const rows = await withUser(db, userId, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .limit(1),
  );
  return rows[0]?.role;
}

export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly status: (typeof documents.status.enumValues)[number];
  readonly createdAt: Date;
}

/**
 * The workspace's documents. Callers check membership and role first (requireWorkspaceRole);
 * row-level security, with the user in context, is the second layer.
 */
export async function listDocuments(
  db: NodePgDatabase,
  context: { readonly workspaceId: string; readonly userId: string },
): Promise<DocumentSummary[]> {
  return withWorkspace(db, context, (tx) =>
    tx
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        createdAt: documents.createdAt,
      })
      .from(documents)
      // Scoped explicitly as well (decision record: every query is scoped by workspace).
      .where(eq(documents.workspaceId, context.workspaceId))
      .orderBy(asc(documents.createdAt), asc(documents.id)),
  );
}
