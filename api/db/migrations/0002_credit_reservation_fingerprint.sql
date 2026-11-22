ALTER TABLE "credit_reservation" ADD COLUMN "request_fingerprint" text;
--> statement-breakpoint
UPDATE "credit_reservation" SET "request_fingerprint" = md5("idempotency_key") WHERE "request_fingerprint" IS NULL;
--> statement-breakpoint
ALTER TABLE "credit_reservation" ALTER COLUMN "request_fingerprint" SET NOT NULL;
