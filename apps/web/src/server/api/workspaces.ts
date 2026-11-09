// Framework-free handlers for the workspace API (build guide 1.12). The route files wire them to
// the app's session store and connection pool; integration tests wire them to a test database.
// Deliberately no `server-only` import and no `@/` alias, so Vitest can load this module.
import type { SessionStore, WorkspaceGuard } from '@chatlium/auth';
import { listDocuments, listUserWorkspaces, type Database } from '@chatlium/db';
import { handled, json } from './http.ts';

export interface WorkspaceApiDependencies {
  readonly sessions: Pick<SessionStore, 'requireSession'>;
  readonly guard: WorkspaceGuard;
  readonly db: Database['db'];
}

export function createWorkspaceApi(dependencies: WorkspaceApiDependencies) {
  return {
    /** GET /api/workspaces: the caller's own workspaces, read through the membership policy. */
    listWorkspaces(request: Request): Promise<Response> {
      return handled(async () => {
        const user = await dependencies.sessions.requireSession(request);
        const workspaces = await listUserWorkspaces(dependencies.db, user.userId);
        return json({ workspaces });
      });
    },

    /** GET /api/workspaces/:id/documents: requires the operator role or higher. */
    listDocuments(request: Request, workspaceId: string): Promise<Response> {
      return handled(async () => {
        const member = await dependencies.guard.requireWorkspaceRole(
          request,
          workspaceId,
          'operator',
        );
        const documents = await listDocuments(dependencies.db, {
          workspaceId: member.workspaceId,
          userId: member.user.userId,
        });
        return json({ documents });
      });
    },
  };
}

export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>;
