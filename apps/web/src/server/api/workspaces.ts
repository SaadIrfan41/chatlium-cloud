// Framework-free handlers for the workspace API (build guide 1.12). The route files wire them to
// the app's session store and connection pool; integration tests wire them to a test database.
// Deliberately no `server-only` import and no `@/` alias, so Vitest can load this module.
import {
  ForbiddenError,
  UnauthenticatedError,
  type SessionStore,
  type WorkspaceGuard,
} from '@chatlium/auth';
import { listDocuments, listUserWorkspaces, type Database } from '@chatlium/db';

export interface WorkspaceApiDependencies {
  readonly sessions: Pick<SessionStore, 'requireSession'>;
  readonly guard: WorkspaceGuard;
  readonly db: Database['db'];
}

/** Tenant data must never be cached by browsers or shared caches. */
const NO_STORE = { 'cache-control': 'no-store' } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Maps authorization failures to responses. Every ForbiddenError gets the same 403 body, so a
 * caller cannot tell "no such workspace" from "not a member" or "role too low".
 */
async function authorized(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return json({ error: 'unauthenticated' }, 401);
    }
    if (error instanceof ForbiddenError) {
      return json({ error: 'forbidden' }, 403);
    }
    throw error;
  }
}

export function createWorkspaceApi(dependencies: WorkspaceApiDependencies) {
  return {
    /** GET /api/workspaces: the caller's own workspaces, read through the membership policy. */
    listWorkspaces(request: Request): Promise<Response> {
      return authorized(async () => {
        const user = await dependencies.sessions.requireSession(request);
        const workspaces = await listUserWorkspaces(dependencies.db, user.userId);
        return json({ workspaces });
      });
    },

    /** GET /api/workspaces/:id/documents: requires the operator role or higher. */
    listDocuments(request: Request, workspaceId: string): Promise<Response> {
      return authorized(async () => {
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
