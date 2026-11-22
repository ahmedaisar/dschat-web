CREATE TABLE "model" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "provider_model_id" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "context_window" integer NOT NULL,
  "max_output_tokens" integer NOT NULL,
  "pricing_version" text NOT NULL,
  "input_rate" bigint NOT NULL,
  "output_rate" bigint NOT NULL,
  "reasoning_rate" bigint NOT NULL,
  "cached_input_rate" bigint NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_to" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_account" ("user_id" text PRIMARY KEY NOT NULL, "available" bigint DEFAULT 0 NOT NULL, "reserved" bigint DEFAULT 0 NOT NULL, "created_at" timestamp with time zone NOT NULL, "updated_at" timestamp with time zone NOT NULL, CONSTRAINT "credit_account_non_negative_check" CHECK ("credit_account"."available" >= 0 and "credit_account"."reserved" >= 0));
--> statement-breakpoint
CREATE TABLE "credit_allocation" ("id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "source" text NOT NULL, "amount" bigint NOT NULL, "remaining" bigint NOT NULL, "starts_at" timestamp with time zone NOT NULL, "expires_at" timestamp with time zone, "idempotency_key" text NOT NULL, "created_at" timestamp with time zone NOT NULL);
--> statement-breakpoint
CREATE TABLE "credit_transaction" ("id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "type" text NOT NULL, "amount" bigint NOT NULL, "balance_before" bigint NOT NULL, "balance_after" bigint NOT NULL, "idempotency_key" text NOT NULL, "reservation_id" text, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamp with time zone NOT NULL);
--> statement-breakpoint
CREATE TABLE "credit_reservation" ("id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "state" text NOT NULL, "maximum" bigint NOT NULL, "idempotency_key" text NOT NULL, "inference_request_id" text, "expires_at" timestamp with time zone NOT NULL, "version" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone NOT NULL);
--> statement-breakpoint
ALTER TABLE "credit_account" ADD CONSTRAINT "credit_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_allocation" ADD CONSTRAINT "credit_allocation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_reservation" ADD CONSTRAINT "credit_reservation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "model_enabled_idx" ON "model" USING btree ("enabled");
CREATE UNIQUE INDEX "credit_allocation_idempotency_idx" ON "credit_allocation" USING btree ("user_id","idempotency_key");
CREATE INDEX "credit_allocation_user_idx" ON "credit_allocation" USING btree ("user_id");
CREATE UNIQUE INDEX "credit_transaction_idempotency_idx" ON "credit_transaction" USING btree ("user_id","idempotency_key");
CREATE INDEX "credit_transaction_user_created_idx" ON "credit_transaction" USING btree ("user_id","created_at");
CREATE UNIQUE INDEX "credit_reservation_idempotency_idx" ON "credit_reservation" USING btree ("user_id","idempotency_key");
CREATE INDEX "credit_reservation_user_idx" ON "credit_reservation" USING btree ("user_id");
