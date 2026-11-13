-- CreateEnum
CREATE TYPE "ParameterSetStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('APP', 'WORKBOOK_IMPORT', 'SEED');

-- CreateEnum
CREATE TYPE "RatingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'FINAL', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OverrideApproval" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "entra_oid" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_code")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "email_tried" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "roles" TEXT[],
    "invited_by" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "request_id" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter_sets" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "method_version" TEXT NOT NULL,
    "workbook_version" TEXT NOT NULL,
    "status" "ParameterSetStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_date" DATE,
    "cloned_from_id" UUID,
    "source" TEXT,
    "notes" TEXT,
    "content_hash" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposed_at" TIMESTAMPTZ(3),
    "proposed_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "activated_by" UUID,
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "parameter_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameters" (
    "set_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value_num" DOUBLE PRECISION,
    "value_text" TEXT,
    "unit" TEXT,
    "ref" TEXT,
    "note" TEXT,
    "proposed" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "parameters_pkey" PRIMARY KEY ("set_id","name")
);

-- CreateTable
CREATE TABLE "rating_scale" (
    "set_id" UUID NOT NULL,
    "grade" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "cx_scale" TEXT NOT NULL,
    "pd" DOUBLE PRECISION NOT NULL,
    "appetite" TEXT NOT NULL,
    "review_months" INTEGER NOT NULL,
    "review_cycle" TEXT NOT NULL,

    CONSTRAINT "rating_scale_pkey" PRIMARY KEY ("set_id","grade")
);

-- CreateTable
CREATE TABLE "overlays" (
    "set_id" UUID NOT NULL,
    "ord" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "max_notches" INTEGER NOT NULL,
    "descriptor_0" TEXT,
    "descriptor_1" TEXT,
    "descriptor_2" TEXT,

    CONSTRAINT "overlays_pkey" PRIMARY KEY ("set_id","ord")
);

-- CreateTable
CREATE TABLE "structures" (
    "set_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_notch" INTEGER NOT NULL,
    "max_notch" INTEGER NOT NULL,
    "self_liquidating" BOOLEAN NOT NULL,
    "offtake" BOOLEAN NOT NULL,
    "ref" TEXT,
    "conditions" TEXT,
    "proposed" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "structures_pkey" PRIMARY KEY ("set_id","code")
);

-- CreateTable
CREATE TABLE "modules" (
    "set_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "factor_set" TEXT NOT NULL,
    "subsector_set" TEXT,
    "haircut_set" TEXT NOT NULL,
    "ref" TEXT,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("set_id","code")
);

-- CreateTable
CREATE TABLE "factors" (
    "set_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "set_code" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "pillar" TEXT NOT NULL,
    "profile" TEXT,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "measure" TEXT,
    "unit" TEXT,
    "type" TEXT NOT NULL,
    "direction" TEXT,
    "scale" INTEGER NOT NULL,
    "nb" INTEGER NOT NULL,
    "bounds" DOUBLE PRECISION[],
    "f_flags" INTEGER[],
    "neg" BOOLEAN NOT NULL,
    "group_code" TEXT,
    "optional" BOOLEAN NOT NULL,
    "track_only" TEXT,
    "role" TEXT,
    "link" TEXT,
    "ref" TEXT,
    "auto_code" TEXT,
    "legacy_top_cut" DOUBLE PRECISION,
    "legacy_bot_cut" DOUBLE PRECISION,
    "legacy_judge" DOUBLE PRECISION,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "factors_pkey" PRIMARY KEY ("set_id","key")
);

-- CreateTable
CREATE TABLE "factor_descriptors" (
    "set_id" UUID NOT NULL,
    "factor_key" TEXT NOT NULL,
    "band" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "factor_descriptors_pkey" PRIMARY KEY ("set_id","factor_key","band")
);

-- CreateTable
CREATE TABLE "sub_sectors" (
    "set_id" UUID NOT NULL,
    "set_code" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "grade_low" DOUBLE PRECISION,
    "grade_high" DOUBLE PRECISION,
    "special" TEXT,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "sub_sectors_pkey" PRIMARY KEY ("set_id","set_code","ord")
);

-- CreateTable
CREATE TABLE "collateral_haircuts" (
    "set_id" UUID NOT NULL,
    "set_code" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "haircut_low" DOUBLE PRECISION NOT NULL,
    "haircut_high" DOUBLE PRECISION NOT NULL,
    "cross_border_addon" DOUBLE PRECISION NOT NULL,
    "ref" TEXT,
    "linked_core_ord" INTEGER,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "collateral_haircuts_pkey" PRIMARY KEY ("set_id","set_code","ord")
);

-- CreateTable
CREATE TABLE "sector_questions" (
    "set_id" UUID NOT NULL,
    "module_code" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "flag_answer" TEXT NOT NULL,
    "target_factor_key" TEXT,
    "modifier_type" TEXT,
    "modifier_value" DOUBLE PRECISION,
    "ref" TEXT,
    "proposed" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "sector_questions_pkey" PRIMARY KEY ("set_id","module_code","ord")
);

-- CreateTable
CREATE TABLE "stress_shocks" (
    "set_id" UUID NOT NULL,
    "module_code" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "size_text" TEXT,
    "ref" TEXT,
    "cost_type" TEXT NOT NULL,
    "default_value" DOUBLE PRECISION NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "stress_shocks_pkey" PRIMARY KEY ("set_id","module_code","ord")
);

-- CreateTable
CREATE TABLE "list_items" (
    "set_id" UUID NOT NULL,
    "list_code" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "list_items_pkey" PRIMARY KEY ("set_id","list_code","sort")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "reg_no" TEXT NOT NULL,
    "reg_no_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector_module" TEXT,
    "contacts" JSONB,
    "notes" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'APP',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "deal_id" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "sponsor_company_id" UUID,
    "facility_type" TEXT,
    "amount" DECIMAL(18,2),
    "tenor_months" INTEGER,
    "module_code" TEXT,
    "track" TEXT,
    "stage" TEXT NOT NULL,
    "stage_changed_at" TIMESTAMPTZ(3),
    "stage_changed_by" UUID,
    "legacy_pdf_path" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'APP',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "rating_id" TEXT NOT NULL,
    "deal_ref" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rating_type" TEXT NOT NULL,
    "status" "RatingStatus" NOT NULL DEFAULT 'DRAFT',
    "analyst_id" UUID,
    "analyst_name" TEXT,
    "reviewer_id" UUID,
    "reviewer_name" TEXT,
    "ic_approver_id" UUID,
    "rating_date" DATE,
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalised_at" TIMESTAMPTZ(3),
    "superseded_by_id" UUID,
    "parameter_set_id" UUID NOT NULL,
    "method_version" TEXT NOT NULL,
    "workbook_version" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "input_schema_version" INTEGER NOT NULL,
    "source" "RecordSource" NOT NULL DEFAULT 'APP',
    "module_code" TEXT,
    "track" TEXT,
    "blended_score" DOUBLE PRECISION,
    "obligor_model" INTEGER,
    "obligor_final" INTEGER,
    "facility_model" INTEGER,
    "facility_final" INTEGER,
    "pd" DOUBLE PRECISION,
    "lgd" DOUBLE PRECISION,
    "ead" DOUBLE PRECISION,
    "el_usd" DOUBLE PRECISION,
    "el_pct" DOUBLE PRECISION,
    "recommendation" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "history_enabled" BOOLEAN NOT NULL,
    "review_cycle" TEXT,
    "next_review_date" DATE,
    "checks_errors" INTEGER NOT NULL DEFAULT 0,
    "checks_warnings" INTEGER NOT NULL DEFAULT 0,
    "knockouts" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_inputs" (
    "rating_ref" UUID NOT NULL,
    "inputs" JSONB NOT NULL,
    "history_snapshot" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "rating_inputs_pkey" PRIMARY KEY ("rating_ref")
);

-- CreateTable
CREATE TABLE "rating_results" (
    "rating_ref" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_results_pkey" PRIMARY KEY ("rating_ref")
);

-- CreateTable
CREATE TABLE "rating_checks" (
    "rating_ref" UUID NOT NULL,
    "check_no" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "rating_checks_pkey" PRIMARY KEY ("rating_ref","check_no")
);

-- CreateTable
CREATE TABLE "overrides" (
    "id" UUID NOT NULL,
    "rating_ref" UUID NOT NULL,
    "grade_type" TEXT NOT NULL,
    "model_grade" INTEGER NOT NULL,
    "final_grade" INTEGER NOT NULL,
    "notches" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "logged_on" DATE NOT NULL,
    "analyst_name" TEXT,
    "requested_by" UUID,
    "approval_status" "OverrideApproval" NOT NULL,
    "approver_id" UUID,
    "approver_name_text" TEXT,
    "approval_date" DATE,
    "approved_at" TIMESTAMPTZ(3),
    "comment" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'APP',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_comments" (
    "id" UUID NOT NULL,
    "rating_ref" UUID NOT NULL,
    "author_id" UUID,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_activity" (
    "id" UUID NOT NULL,
    "entry_id" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "reg_no" TEXT NOT NULL,
    "borrower_name" TEXT,
    "deal_ref" UUID,
    "deal_id" TEXT,
    "event_type" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "due_date" DATE,
    "amount_due" DECIMAL(18,2),
    "amount_paid" DECIMAL(18,2),
    "days_late" INTEGER,
    "notes" TEXT,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entered_by" UUID,
    "entered_by_text" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "source" "RecordSource" NOT NULL DEFAULT 'APP',

    CONSTRAINT "deal_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_history_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reg_no" TEXT NOT NULL,
    "deal_ref" TEXT,
    "facility_type" TEXT,
    "amount" DECIMAL(18,2),
    "disbursement_date" DATE,
    "maturity_date" DATE,
    "status" TEXT NOT NULL,
    "max_dpd" INTEGER,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "manual_history_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_notes" (
    "id" UUID NOT NULL,
    "rating_ref" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "mode" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "report" JSONB NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_status" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_status_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "changelog" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "change" TEXT NOT NULL,

    CONSTRAINT "changelog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_entra_oid_key" ON "users"("entra_oid");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "login_events_email_tried_at_idx" ON "login_events"("email_tried", "at");

-- CreateIndex
CREATE INDEX "login_events_ip_at_idx" ON "login_events"("ip", "at");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_sets_version_key" ON "parameter_sets"("version");

-- CreateIndex
CREATE UNIQUE INDEX "companies_reg_no_key_key" ON "companies"("reg_no_key");

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "deals_deal_id_key" ON "deals"("deal_id");

-- CreateIndex
CREATE INDEX "deals_company_id_idx" ON "deals"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_rating_id_key" ON "ratings"("rating_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_superseded_by_id_key" ON "ratings"("superseded_by_id");

-- CreateIndex
CREATE INDEX "ratings_deal_ref_status_idx" ON "ratings"("deal_ref", "status");

-- CreateIndex
CREATE INDEX "ratings_company_id_idx" ON "ratings"("company_id");

-- CreateIndex
CREATE INDEX "ratings_status_rating_date_idx" ON "ratings"("status", "rating_date");

-- CreateIndex
CREATE INDEX "ratings_next_review_date_idx" ON "ratings"("next_review_date");

-- CreateIndex
CREATE INDEX "rating_checks_status_idx" ON "rating_checks"("status");

-- CreateIndex
CREATE INDEX "overrides_logged_on_idx" ON "overrides"("logged_on");

-- CreateIndex
CREATE UNIQUE INDEX "overrides_rating_ref_grade_type_key" ON "overrides"("rating_ref", "grade_type");

-- CreateIndex
CREATE INDEX "rating_comments_rating_ref_idx" ON "rating_comments"("rating_ref");

-- CreateIndex
CREATE UNIQUE INDEX "deal_activity_entry_id_key" ON "deal_activity"("entry_id");

-- CreateIndex
CREATE INDEX "deal_activity_company_id_event_date_idx" ON "deal_activity"("company_id", "event_date");

-- CreateIndex
CREATE INDEX "deal_activity_deal_id_idx" ON "deal_activity"("deal_id");

-- CreateIndex
CREATE INDEX "manual_history_records_company_id_idx" ON "manual_history_records"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "screening_notes_storage_key_key" ON "screening_notes"("storage_key");

-- CreateIndex
CREATE INDEX "screening_notes_rating_ref_idx" ON "screening_notes"("rating_ref");

-- CreateIndex
CREATE UNIQUE INDEX "changelog_version_date_key" ON "changelog"("version", "date");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter_sets" ADD CONSTRAINT "parameter_sets_cloned_from_id_fkey" FOREIGN KEY ("cloned_from_id") REFERENCES "parameter_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameters" ADD CONSTRAINT "parameters_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_scale" ADD CONSTRAINT "rating_scale_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structures" ADD CONSTRAINT "structures_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factors" ADD CONSTRAINT "factors_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factor_descriptors" ADD CONSTRAINT "factor_descriptors_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_sectors" ADD CONSTRAINT "sub_sectors_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collateral_haircuts" ADD CONSTRAINT "collateral_haircuts_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector_questions" ADD CONSTRAINT "sector_questions_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stress_shocks" ADD CONSTRAINT "stress_shocks_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "parameter_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_sponsor_company_id_fkey" FOREIGN KEY ("sponsor_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_deal_ref_fkey" FOREIGN KEY ("deal_ref") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_parameter_set_id_fkey" FOREIGN KEY ("parameter_set_id") REFERENCES "parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "ratings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_inputs" ADD CONSTRAINT "rating_inputs_rating_ref_fkey" FOREIGN KEY ("rating_ref") REFERENCES "ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_results" ADD CONSTRAINT "rating_results_rating_ref_fkey" FOREIGN KEY ("rating_ref") REFERENCES "ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_checks" ADD CONSTRAINT "rating_checks_rating_ref_fkey" FOREIGN KEY ("rating_ref") REFERENCES "ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_rating_ref_fkey" FOREIGN KEY ("rating_ref") REFERENCES "ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_comments" ADD CONSTRAINT "rating_comments_rating_ref_fkey" FOREIGN KEY ("rating_ref") REFERENCES "ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_activity" ADD CONSTRAINT "deal_activity_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_activity" ADD CONSTRAINT "deal_activity_deal_ref_fkey" FOREIGN KEY ("deal_ref") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_history_records" ADD CONSTRAINT "manual_history_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_notes" ADD CONSTRAINT "screening_notes_rating_ref_fkey" FOREIGN KEY ("rating_ref") REFERENCES "ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
