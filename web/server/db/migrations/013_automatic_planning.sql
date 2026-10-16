-- Existing runs remain manual; opening old conversations must never accept them.
ALTER TABLE app.agent_runs ADD COLUMN application_policy text NOT NULL DEFAULT 'manual'
  CHECK (application_policy IN ('manual', 'automatic'));
CREATE FUNCTION app.guard_run_application_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.application_policy IS DISTINCT FROM OLD.application_policy THEN
    RAISE EXCEPTION 'run application policy is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_application_policy BEFORE UPDATE ON app.agent_runs
  FOR EACH ROW EXECUTE FUNCTION app.guard_run_application_policy();
