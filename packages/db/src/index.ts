// Runtime API for application processes. Role bootstrap and migrations live in
// `@chatlium/db/admin`, so application bundles never contain them.
export { createDatabase, type Database } from './client.ts';
export * as schema from './schema.ts';
export {
  InvalidTenantIdError,
  withUser,
  withWorkspace,
  type TenantTransaction,
  type WorkspaceContext,
} from './tenant.ts';
export { upsertUserByCognitoSub, type CognitoIdentity } from './users.ts';
