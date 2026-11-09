export { createDatabase, type Database } from './client.ts';
export { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
export * as schema from './schema.ts';
export {
  APP_ROLE,
  MIGRATIONS_SCHEMA,
  bootstrapRoles,
  OWNER_ROLE,
  readRoleFlags,
  type BootstrapOptions,
  type RoleFlags,
} from './roles.ts';
export { InvalidTenantIdError, withUser, withWorkspace, type TenantTransaction } from './tenant.ts';
