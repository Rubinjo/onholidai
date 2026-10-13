-- Additive: 004 may already be applied; never replace its checksum.
ALTER TABLE app.agent_runs ADD COLUMN last_durable_progress_at timestamptz;
ALTER TABLE app.agent_runs ADD COLUMN result_fingerprint text;
ALTER TABLE app.agent_runs ADD COLUMN result_cursor integer;
ALTER TABLE app.agent_runs ADD COLUMN dispatch_fingerprint text;
ALTER TABLE app.agent_runs ADD COLUMN active_elapsed_ms bigint NOT NULL DEFAULT 0 CHECK (active_elapsed_ms >= 0);
ALTER TABLE app.agent_runs ADD COLUMN phase_started_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE app.agent_run_events (
  run_id uuid NOT NULL REFERENCES app.agent_runs(id) ON DELETE RESTRICT,
  cursor integer NOT NULL CHECK (cursor > 0),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, cursor)
);
CREATE TABLE app.agent_run_resumes (
  run_id uuid NOT NULL REFERENCES app.agent_runs(id),
  question_id uuid NOT NULL,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  event_cursor integer NOT NULL CHECK (event_cursor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, question_id),
  UNIQUE (run_id, request_id)
);
CREATE TABLE app.planning_offer_records (
  run_id uuid NOT NULL REFERENCES app.agent_runs(id),
  component_id uuid NOT NULL,
  offer jsonb NOT NULL CHECK (jsonb_typeof(offer) = 'object'),
  query jsonb NOT NULL CHECK (jsonb_typeof(query) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, component_id)
);
CREATE TABLE app.estimate_candidates (
  proposal_id uuid PRIMARY KEY REFERENCES app.change_proposals(id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object')
);
CREATE FUNCTION app.guard_run_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.trip_id, NEW.conversation_id, NEW.owner_user_id, NEW.request_id,
      NEW.base_trip_version, NEW.purpose, NEW.request_fingerprint, NEW.started_at)
    IS DISTINCT FROM
    (OLD.id, OLD.trip_id, OLD.conversation_id, OLD.owner_user_id, OLD.request_id,
      OLD.base_trip_version, OLD.purpose, OLD.request_fingerprint, OLD.started_at) THEN
    RAISE EXCEPTION 'run identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.event_cursor < OLD.event_cursor THEN
    RAISE EXCEPTION 'run cursor cannot decrease' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_identity_immutable BEFORE UPDATE ON app.agent_runs
  FOR EACH ROW EXECUTE FUNCTION app.guard_run_identity();
REVOKE UPDATE, DELETE ON app.agent_run_events, app.agent_run_resumes,
  app.planning_offer_records, app.estimate_candidates FROM onholidai_web, onholidai_worker;
ALTER TABLE app.conversation_messages ADD CONSTRAINT conversation_message_run
  FOREIGN KEY (agent_run_id) REFERENCES app.agent_runs(id);
