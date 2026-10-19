ALTER TABLE app.agent_runs DROP CONSTRAINT agent_runs_purpose_check;
ALTER TABLE app.agent_runs ADD CONSTRAINT agent_runs_purpose_check
  CHECK (purpose IN ('initial_estimate', 'refinement', 'finalization', 'supplier_research'));
ALTER TABLE app.agent_runs ADD COLUMN research_result jsonb CHECK (research_result IS NULL OR jsonb_typeof(research_result) = 'object');

ALTER TABLE app.planning_offer_records ADD COLUMN offer_ref uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE app.planning_offer_records ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE app.planning_offer_records DROP CONSTRAINT planning_offer_records_pkey;
ALTER TABLE app.planning_offer_records ADD PRIMARY KEY (run_id, component_id, revision);
ALTER TABLE app.planning_offer_records ADD CONSTRAINT planning_offer_revision UNIQUE (offer_ref, revision);
CREATE INDEX planning_offer_source ON app.planning_offer_records (run_id, created_at);

CREATE FUNCTION app.guard_research_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.agent_runs WHERE id = NEW.agent_run_id AND purpose = 'supplier_research') THEN
    RAISE EXCEPTION 'read-only research cannot create proposals' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER research_cannot_propose BEFORE INSERT OR UPDATE OF agent_run_id ON app.change_proposals
  FOR EACH ROW EXECUTE FUNCTION app.guard_research_proposal();
