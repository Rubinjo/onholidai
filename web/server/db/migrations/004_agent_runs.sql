ALTER TABLE app.conversations ADD CONSTRAINT conversations_scoped_identity
  UNIQUE (id, trip_id, owner_user_id);

CREATE TABLE app.agent_runs (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  request_id uuid NOT NULL,
  base_trip_version integer NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('initial_estimate', 'refinement', 'finalization')),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued', 'running', 'awaiting_clarification', 'proposed', 'completed', 'failed', 'cancelled')),
  event_cursor integer NOT NULL DEFAULT 0 CHECK (event_cursor >= 0),
  lease_expires_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_category text CHECK (error_category IN ('interrupted', 'deadline', 'source_unavailable', 'invalid_result')),
  result jsonb,
  UNIQUE (owner_user_id, request_id),
  UNIQUE (id, trip_id, request_id, base_trip_version),
  FOREIGN KEY (conversation_id, trip_id, owner_user_id)
    REFERENCES app.conversations (id, trip_id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, base_trip_version) REFERENCES app.trip_versions (trip_id, version),
  CHECK (status <> 'awaiting_clarification' OR lease_expires_at IS NULL),
  CHECK (status NOT IN ('queued', 'running') OR lease_expires_at IS NOT NULL),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);

CREATE INDEX agent_runs_lease_idx ON app.agent_runs (lease_expires_at)
  WHERE status IN ('queued', 'running');

CREATE TABLE app.change_proposals (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL,
  agent_run_id uuid NOT NULL,
  initiating_request_id uuid NOT NULL,
  base_trip_version integer NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('initial_estimate', 'refinement', 'finalization')),
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal) = 'object'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('proposed', 'needs_clarification', 'accepted', 'applied', 'rejected', 'stale')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  applied_version integer,
  FOREIGN KEY (agent_run_id, trip_id, initiating_request_id, base_trip_version)
    REFERENCES app.agent_runs (id, trip_id, request_id, base_trip_version) ON DELETE RESTRICT,
  FOREIGN KEY (trip_id, applied_version) REFERENCES app.trip_versions (trip_id, version),
  CHECK ((status = 'applied') = (applied_version IS NOT NULL))
);
CREATE INDEX change_proposals_trip_idx ON app.change_proposals (trip_id, created_at, id);

CREATE FUNCTION app.guard_proposal_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.trip_id, NEW.agent_run_id, NEW.initiating_request_id, NEW.base_trip_version,
    NEW.purpose, NEW.proposal, NEW.request_fingerprint, NEW.created_at, NEW.expires_at)
    IS DISTINCT FROM
    (OLD.id, OLD.trip_id, OLD.agent_run_id, OLD.initiating_request_id, OLD.base_trip_version,
    OLD.purpose, OLD.proposal, OLD.request_fingerprint, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'proposal identity and review evidence are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'proposed' AND NEW.status IN ('accepted', 'rejected', 'stale')) OR
    (OLD.status = 'accepted' AND NEW.status IN ('applied', 'stale')) OR
    (OLD.status = 'needs_clarification' AND NEW.status IN ('rejected', 'stale'))
  ) THEN
    RAISE EXCEPTION 'invalid proposal transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proposal_identity_immutable BEFORE UPDATE ON app.change_proposals
  FOR EACH ROW EXECUTE FUNCTION app.guard_proposal_identity();
REVOKE DELETE ON app.change_proposals FROM onholidai_web, onholidai_worker;
