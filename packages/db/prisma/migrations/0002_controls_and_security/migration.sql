-- Database-level controls (docs/architecture.md sections 2, 7, 8). Plain PostgreSQL only.

-- 1. Exactly one ACTIVE parameter set at a time ------------------------------------------------
CREATE UNIQUE INDEX "parameter_sets_one_active" ON "parameter_sets" ("status") WHERE "status" = 'ACTIVE';

-- 2. A parameter set's tables can only change while it is a DRAFT -------------------------------
CREATE FUNCTION crs_parameter_set_is_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sid uuid := COALESCE(NEW.set_id, OLD.set_id);
  st  text;
BEGIN
  SELECT status INTO st FROM parameter_sets WHERE id = sid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'Parameter set % is % and cannot be changed; clone it into a new draft', sid, st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parameters','rating_scale','overlays','structures','modules','factors',
                           'factor_descriptors','sub_sectors','collateral_haircuts','sector_questions',
                           'stress_shocks','list_items'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION crs_parameter_set_is_draft()', t || '_draft_only', t);
  END LOOP;
END $$;

-- 3. A Final (or Superseded) rating never changes ------------------------------------------------
-- Only these transitions are allowed: FINAL -> SUPERSEDED with superseded_by_id set.
CREATE FUNCTION crs_rating_is_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('FINAL', 'SUPERSEDED') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Rating % is % and cannot be deleted', OLD.rating_id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'superseded_by_id' - 'updated_at') <> (to_jsonb(OLD) - 'status' - 'superseded_by_id' - 'updated_at')
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'FINAL' AND NEW.status = 'SUPERSEDED')) THEN
      RAISE EXCEPTION 'Rating % is % and cannot be changed', OLD.rating_id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER ratings_frozen BEFORE UPDATE OR DELETE ON "ratings" FOR EACH ROW EXECUTE FUNCTION crs_rating_is_frozen();

CREATE FUNCTION crs_rating_child_is_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM ratings WHERE id = COALESCE(NEW.rating_ref, OLD.rating_ref);
  IF st IN ('FINAL', 'SUPERSEDED') AND (TG_OP <> 'INSERT') THEN
    RAISE EXCEPTION 'The inputs and results of a % rating cannot be changed', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER rating_inputs_frozen BEFORE UPDATE OR DELETE ON "rating_inputs" FOR EACH ROW EXECUTE FUNCTION crs_rating_child_is_frozen();
CREATE TRIGGER rating_results_frozen BEFORE UPDATE OR DELETE ON "rating_results" FOR EACH ROW EXECUTE FUNCTION crs_rating_child_is_frozen();
CREATE TRIGGER rating_checks_frozen BEFORE UPDATE OR DELETE ON "rating_checks" FOR EACH ROW EXECUTE FUNCTION crs_rating_child_is_frozen();

-- 4. Simple value checks --------------------------------------------------------------------------
ALTER TABLE "rating_checks" ADD CONSTRAINT "rating_checks_status" CHECK ("status" IN ('Passed', 'Warning', 'Error'));
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_grade_type" CHECK ("grade_type" IN ('Obligor', 'Facility'));
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_reason" CHECK (length(trim("reason")) > 0);
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower" CHECK ("email" = lower("email"));

-- 5. Least privilege and Row Level Security --------------------------------------------------------
-- The app connects as crs_app (data only, no DDL). The role is created here without a password and
-- cannot log in until ops/sql/roles.sql gives it one. RLS is enabled on every table with a single
-- policy for crs_app, so Supabase's public roles (anon, authenticated) see nothing even if the Data API
-- were switched on.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crs_app') THEN CREATE ROLE crs_app NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO crs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crs_app;
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN REVOKE ALL ON TABLE "_prisma_migrations" FROM crs_app; END IF;
END $$;
-- Tables and sequences created later by the migrating role are granted the same way. Every new table
-- must also enable RLS with the crs_app policy; packages/db/test/security.test.ts fails if one does not.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crs_app;
-- The audit log and login history are append-only for the app
REVOKE UPDATE, DELETE ON TABLE "audit_log", "login_events" FROM crs_app;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY crs_app_all ON %I TO crs_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
