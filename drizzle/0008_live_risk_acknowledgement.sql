CREATE TABLE "live_risk_acknowledgements" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"version" varchar(32) NOT NULL,
	"statement_ids" jsonb NOT NULL,
	"country" varchar(2),
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_risk_acknowledgements" ADD CONSTRAINT "live_risk_acknowledgements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;