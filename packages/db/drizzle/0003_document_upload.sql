-- Step 2.2: documents record the uploader's declared content type and size, and each S3 key
-- belongs to exactly one document.
--
-- Existing rows (development seed data, from before uploads existed) are filled through column
-- defaults that are dropped again. An UPDATE would not work: migrations run as chatlium_owner,
-- and FORCE ROW LEVEL SECURITY hides every row from the owner when no workspace is set, so the
-- UPDATE would silently change nothing. DDL defaults fill all rows regardless of RLS.
ALTER TABLE "documents" ADD COLUMN "content_type" text NOT NULL DEFAULT 'text/plain';--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "content_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "size_bytes" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "size_bytes" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_s3_key_key" ON "documents" USING btree ("s3_key");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_bytes_positive" CHECK ("documents"."size_bytes" > 0);
