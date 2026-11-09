-- Step 2.3: a failed document records why, as one of the codes in @chatlium/contracts
-- (DOCUMENT_FAILURE_REASONS). The reason is only allowed on a failed document. Existing rows need
-- no backfill: the column is nullable and NULL passes the check.
ALTER TABLE "documents" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_failure_reason_valid" CHECK ("documents"."failure_reason" IS NULL OR ("documents"."status" = 'failed' AND "documents"."failure_reason" IN ('type_mismatch', 'invalid_utf8', 'invalid_json', 'empty_document', 'no_text_layer', 'encrypted_pdf', 'unreadable_pdf', 'too_many_pages', 'too_large', 'object_missing')));