import 'server-only';
import { createWorkspaceGuard, type WorkspaceGuard } from '@chatlium/auth';
import { findMembershipRole } from '@chatlium/db';
import { sessions } from '../auth/cookies.ts';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { indexingQueue } from '../queue.ts';
import { documentStorage } from '../storage.ts';
import { createDocumentApi, type DocumentApi } from './documents.ts';
import { createWorkspaceApi, type WorkspaceApi } from './workspaces.ts';

let guard: WorkspaceGuard | undefined;
let workspaces: WorkspaceApi | undefined;
let documents: DocumentApi | undefined;

function workspaceGuard(): WorkspaceGuard {
  guard ??= createWorkspaceGuard({
    sessions: sessions(),
    lookupRole: (userId, workspaceId) => findMembershipRole(db(), userId, workspaceId),
  });
  return guard;
}

/** The workspace API wired to the app's session cookie and its chatlium_app connection pool. */
export function workspaceApi(): WorkspaceApi {
  workspaces ??= createWorkspaceApi({ sessions: sessions(), guard: workspaceGuard(), db: db() });
  return workspaces;
}

/** Document upload, wired to S3 (Floci locally) and the Phase 2 in-process indexing queue. */
export function documentApi(): DocumentApi {
  documents ??= createDocumentApi({
    guard: workspaceGuard(),
    db: db(),
    storage: documentStorage(),
    indexingQueue: indexingQueue(),
    appOrigin: new URL(config().APP_BASE_URL).origin,
  });
  return documents;
}
