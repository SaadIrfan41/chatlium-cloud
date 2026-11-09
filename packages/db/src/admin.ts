// Administrative API: role bootstrap (as the database administrator) and migrations (as
// chatlium_owner). Used by packages/db scripts, deployment jobs and tests; never by the app.
export { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
export {
  APP_ROLE,
  bootstrapRoles,
  MIGRATIONS_SCHEMA,
  OWNER_ROLE,
  readRoleFlags,
  type BootstrapOptions,
  type RoleFlags,
} from './roles.ts';
