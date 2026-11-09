import { defineConfig } from 'drizzle-kit';

// Migrations are generated from src/schema.ts and applied as chatlium_owner (ADR 0002).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env['DATABASE_OWNER_URL'] ?? '',
  },
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
  strict: true,
  verbose: true,
});
