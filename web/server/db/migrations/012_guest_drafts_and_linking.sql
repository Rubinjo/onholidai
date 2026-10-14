CREATE TABLE app.setup_drafts (
  id uuid PRIMARY KEY,
  planning_owner_id text NOT NULL UNIQUE REFERENCES app.planning_principals (id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  current_step text NOT NULL CHECK (current_step IN ('destinations', 'origin', 'dates', 'travellers', 'preferences', 'review')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  creation_request_id uuid NOT NULL,
  research_request_id uuid NOT NULL CHECK (research_request_id <> creation_request_id),
  submitted_trip_id uuid UNIQUE REFERENCES app.trips (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at)
);
CREATE FUNCTION app.guard_setup_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.planning_owner_id, NEW.creation_request_id, NEW.research_request_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.planning_owner_id, OLD.creation_request_id, OLD.research_request_id, OLD.created_at)
    OR (OLD.submitted_trip_id IS NOT NULL AND NEW.submitted_trip_id IS DISTINCT FROM OLD.submitted_trip_id)
    OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'draft identity is immutable and revisions advance once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER setup_draft_identity BEFORE UPDATE ON app.setup_drafts FOR EACH ROW EXECUTE FUNCTION app.guard_setup_draft();

CREATE TABLE app.booking_intents (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  planning_owner_id text NOT NULL REFERENCES app.planning_principals (id) ON DELETE RESTRICT,
  guest_session_id uuid NOT NULL REFERENCES app.guest_planning_sessions (id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (action = 'review_booking'),
  state text NOT NULL CHECK (state IN ('pending', 'consumed', 'expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at = created_at + interval '30 minutes'),
  consumed_by_user_id text REFERENCES app."user" (id) ON DELETE RESTRICT,
  consumed_at timestamptz,
  UNIQUE (guest_session_id, request_id),
  CHECK ((state = 'consumed' AND consumed_by_user_id IS NOT NULL AND consumed_at IS NOT NULL)
    OR (state <> 'consumed' AND consumed_by_user_id IS NULL AND consumed_at IS NULL))
);
CREATE TABLE app.planning_account_links (
  planning_owner_id text PRIMARY KEY REFERENCES app.planning_principals (id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  guest_session_id uuid NOT NULL REFERENCES app.guest_planning_sessions (id) ON DELETE RESTRICT,
  account_user_id text NOT NULL REFERENCES app."user" (id) ON DELETE RESTRICT,
  intent_id uuid NOT NULL REFERENCES app.booking_intents (id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  linked_at timestamptz NOT NULL,
  trip_version_at_link integer NOT NULL CHECK (trip_version_at_link > 0),
  FOREIGN KEY (trip_id, trip_version_at_link) REFERENCES app.trip_versions (trip_id, version)
);
CREATE FUNCTION app.guard_planning_link_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'planning account link receipts are append-only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER planning_link_receipt_immutable BEFORE UPDATE OR DELETE ON app.planning_account_links
  FOR EACH ROW EXECUTE FUNCTION app.guard_planning_link_receipt();
CREATE FUNCTION app.guard_booking_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.trip_id, NEW.planning_owner_id, NEW.guest_session_id, NEW.request_id, NEW.fingerprint,
      NEW.action, NEW.created_at, NEW.expires_at) IS DISTINCT FROM
    (OLD.id, OLD.trip_id, OLD.planning_owner_id, OLD.guest_session_id, OLD.request_id, OLD.fingerprint,
      OLD.action, OLD.created_at, OLD.expires_at) OR
    (OLD.state <> 'pending' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'booking intent identity and consumed outcome are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_intent_identity BEFORE UPDATE ON app.booking_intents FOR EACH ROW EXECUTE FUNCTION app.guard_booking_intent();

ALTER TABLE app.agent_runs ADD COLUMN planning_access_revoked_at timestamptz;
CREATE FUNCTION app.guard_run_access_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.planning_access_revoked_at IS NOT NULL AND NEW.planning_access_revoked_at IS DISTINCT FROM OLD.planning_access_revoked_at THEN
    RAISE EXCEPTION 'planning run revocation is permanent' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planning_run_revocation BEFORE UPDATE ON app.agent_runs FOR EACH ROW EXECUTE FUNCTION app.guard_run_access_revocation();
CREATE TABLE app.guest_research_requests (
  guest_session_id uuid NOT NULL REFERENCES app.guest_planning_sessions (id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES app.agent_runs (id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (guest_session_id, request_id)
);
CREATE INDEX guest_research_requests_window ON app.guest_research_requests (guest_session_id, accepted_at);
CREATE TABLE app.guest_bootstrap_buckets (
  network_digest text NOT NULL CHECK (network_digest ~ '^[a-f0-9]{64}$'),
  started_at timestamptz NOT NULL,
  session_count integer NOT NULL CHECK (session_count > 0),
  PRIMARY KEY (network_digest, started_at)
);
GRANT SELECT, INSERT, UPDATE ON app.setup_drafts, app.booking_intents, app.guest_bootstrap_buckets TO onholidai_web;
GRANT SELECT, INSERT ON app.planning_account_links, app.guest_research_requests TO onholidai_web;
GRANT DELETE ON app.guest_research_requests, app.guest_bootstrap_buckets TO onholidai_web;
GRANT SELECT ON app.planning_account_links TO onholidai_worker;
