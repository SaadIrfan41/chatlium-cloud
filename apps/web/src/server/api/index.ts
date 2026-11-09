import 'server-only';
import { createWorkspaceGuard } from '@chatlium/auth';
import { findMembershipRole } from '@chatlium/db';
import { sessions } from '../auth/cookies.ts';
import { db } from '../db.ts';
import { createWorkspaceApi, type WorkspaceApi } from './workspaces.ts';

let api: WorkspaceApi | undefined;

/** The workspace API wired to the app's session cookie and its chatlium_app connection pool. */
export function workspaceApi(): WorkspaceApi {
  api ??= createWorkspaceApi({
    sessions: sessions(),
    guard: createWorkspaceGuard({
      sessions: sessions(),
      lookupRole: (userId, workspaceId) => findMembershipRole(db(), userId, workspaceId),
    }),
    db: db(),
  });
  return api;
}
