/**
 * Phase 1 schema (build guide Step 1.6).
 *
 * Tenant-owned tables carry `workspace_id`. Row-level security for them is defined in a
 * hand-written migration (drizzle/0001_rls.sql) because Drizzle cannot express
 * FORCE ROW LEVEL SECURITY.
 */
import { DOCUMENT_FAILURE_REASONS, type DocumentFailureReason } from '@chatlium/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** PostgreSQL 18's time-ordered UUIDs: new rows append to the end of the primary-key index. */
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const membershipRole = pgEnum('membership_role', ['owner', 'admin', 'operator']);
export const documentStatus = pgEnum('document_status', ['pending', 'uploaded', 'ready', 'failed']);
export const conversationStatus = pgEnum('conversation_status', ['active', 'escalated']);

/** Application users, linked to Cognito by `cognito_sub`. Not tenant-scoped. */
export const users = pgTable('users', {
  id: id(),
  cognitoSub: text('cognito_sub').notNull().unique(),
  email: text('email').notNull(),
  createdAt: createdAt(),
});

/** The tenant. Not row-level secured itself: access is decided through memberships. */
export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: membershipRole('role').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('memberships_workspace_user_key').on(table.workspaceId, table.userId),
    index('memberships_user_id_idx').on(table.userId),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    title: text('title').notNull(),
    status: documentStatus('status').notNull().default('pending'),
    s3Key: text('s3_key').notNull(),
    /** As declared by the uploader, then checked against the stored object (Step 2.2). */
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Set when indexing finishes. Vectors from different models are not comparable. */
    embeddingModel: text('embedding_model'),
    embeddingDims: integer('embedding_dims'),
    /** Why indexing failed: one of DOCUMENT_FAILURE_REASONS, set only with status `failed`. */
    failureReason: text('failure_reason').$type<DocumentFailureReason>(),
    createdAt: createdAt(),
  },
  (table) => [
    index('documents_workspace_id_idx').on(table.workspaceId),
    check('documents_size_bytes_positive', sql`${table.sizeBytes} > 0`),
    // The list is copied into the constraint, so adding a failure reason needs a migration.
    check(
      'documents_failure_reason_valid',
      sql`${table.failureReason} IS NULL OR (${table.status} = 'failed' AND ${table.failureReason} IN (${sql.raw(
        DOCUMENT_FAILURE_REASONS.map((reason) => `'${reason}'`).join(', '),
      )}))`,
    ),
    uniqueIndex('documents_s3_key_key').on(table.s3Key),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    status: conversationStatus('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (table) => [index('conversations_workspace_id_idx').on(table.workspaceId)],
);
