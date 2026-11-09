import { z } from 'zod';
import type { SessionStore, SessionUser } from './session.ts';

/** Membership roles, lowest first. Mirrors the database enum `membership_role`. */
export const WORKSPACE_ROLES = ['operator', 'admin', 'owner'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** True when `role` is `minimum` or higher. */
export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return WORKSPACE_ROLES.indexOf(role) >= WORKSPACE_ROLES.indexOf(minimum);
}

/**
 * The caller may not act on this workspace. Deliberately carries no reason: "not a member",
 * "role too low", "no such workspace" and "not a workspace ID" must all look the same, or the
 * response would reveal which workspace IDs exist (build guide 1.12).
 */
export class ForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'ForbiddenError';
  }
}

export interface WorkspaceMember {
  readonly user: SessionUser;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
}

export interface WorkspaceGuardOptions {
  readonly sessions: Pick<SessionStore, 'requireSession'>;
  /**
   * The user's role in the workspace, or undefined without a membership. Reads with only the user
   * in context (`withUser`), so it can see nothing but the user's own memberships.
   */
  readonly lookupRole: (userId: string, workspaceId: string) => Promise<WorkspaceRole | undefined>;
}

const workspaceIdSchema = z.uuid();

export function createWorkspaceGuard(options: WorkspaceGuardOptions) {
  return {
    /**
     * Build guide 1.12: the signed-in caller's membership of `workspaceId`, if their role is
     * `minimumRole` or higher. Throws UnauthenticatedError without a session, and ForbiddenError
     * otherwise. The caller then runs its queries with `withWorkspace({ workspaceId, userId })`.
     */
    async requireWorkspaceRole(
      request: Request,
      workspaceId: string,
      minimumRole: WorkspaceRole,
    ): Promise<WorkspaceMember> {
      const user = await options.sessions.requireSession(request);
      // A malformed ID cannot name a workspace: answer exactly as for one that does not exist.
      if (!workspaceIdSchema.safeParse(workspaceId).success) {
        throw new ForbiddenError();
      }
      const role = await options.lookupRole(user.userId, workspaceId);
      if (role === undefined || !roleAtLeast(role, minimumRole)) {
        throw new ForbiddenError();
      }
      return { user, workspaceId, role };
    },
  };
}

export type WorkspaceGuard = ReturnType<typeof createWorkspaceGuard>;
