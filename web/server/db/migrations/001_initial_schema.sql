-- Fresh-install baseline. Start with an empty application database.

CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
DECLARE
  required_role text;
BEGIN
  FOREACH required_role IN ARRAY ARRAY[
    'onholidai_migration',
    'onholidai_web',
    'onholidai_worker'
  ]
  LOOP
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = required_role) THEN
      RAISE EXCEPTION 'Required database role % does not exist', required_role;
    END IF;
  END LOOP;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION onholidai_migration;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO onholidai_web, onholidai_worker;

CREATE TABLE app."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  locale text NOT NULL DEFAULT 'en-GB',
  default_currency text NOT NULL DEFAULT 'GBP',
  internal_team_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_locale_not_blank CHECK (btrim(locale) <> ''),
  CONSTRAINT user_default_currency_iso CHECK (default_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT user_internal_team_role_valid CHECK (
    internal_team_role IS NULL
    OR internal_team_role IN ('support', 'operations', 'admin')
  )
);

CREATE TABLE app.session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES app."user" (id) ON DELETE CASCADE
);

CREATE INDEX session_user_id_idx ON app.session (user_id);
CREATE INDEX session_expires_at_idx ON app.session (expires_at);

CREATE TABLE app.account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES app."user" (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_provider_identity_unique UNIQUE (provider_id, account_id)
);

CREATE INDEX account_user_id_idx ON app.account (user_id);

CREATE TABLE app.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_identifier_idx ON app.verification (identifier);
CREATE INDEX verification_expires_at_idx ON app.verification (expires_at);

CREATE TABLE app.spatial_places (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  location geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE app.spatial_routes (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  route geography(LineString, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX spatial_places_location_gist
  ON app.spatial_places USING GIST (location);

CREATE INDEX spatial_routes_route_gist
  ON app.spatial_routes USING GIST (route);

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA app
  TO onholidai_web, onholidai_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO onholidai_web, onholidai_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO onholidai_web, onholidai_worker;

CREATE TABLE app.trips (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES app."user" (id) ON DELETE RESTRICT,
  title text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'draft',
  current_version integer NOT NULL DEFAULT 1,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_title_length CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT trips_lifecycle_state_valid CHECK (
    lifecycle_state IN ('draft', 'finalized', 'partially_booked', 'booked', 'cancelled')
  ),
  CONSTRAINT trips_current_version_positive CHECK (current_version > 0),
  CONSTRAINT trips_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT trips_timestamps_ordered CHECK (
    updated_at >= created_at AND last_activity_at >= created_at
  )
);

CREATE INDEX trips_owner_activity_idx ON app.trips (owner_user_id, last_activity_at DESC);

CREATE TABLE app.trip_versions (
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  version integer NOT NULL,
  previous_version integer,
  schema_version integer NOT NULL,
  snapshot jsonb NOT NULL,
  initiating_actor text NOT NULL,
  initiating_request_id uuid NOT NULL,
  proposal_id uuid,
  change_summary jsonb NOT NULL,
  inverse_operation jsonb,
  non_reversible_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, version),
  CONSTRAINT trip_versions_version_positive CHECK (version > 0),
  CONSTRAINT trip_versions_previous_contiguous CHECK (
    (version = 1 AND previous_version IS NULL)
    OR (version > 1 AND previous_version = version - 1)
  ),
  CONSTRAINT trip_versions_schema_positive CHECK (schema_version > 0),
  CONSTRAINT trip_versions_snapshot_object CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT trip_versions_actor_valid CHECK (
    initiating_actor IN ('user', 'agent_proposal', 'system_revalidation', 'booking_workflow')
  ),
  CONSTRAINT trip_versions_proposal_required CHECK (
    (initiating_actor = 'agent_proposal' AND proposal_id IS NOT NULL)
    OR (initiating_actor <> 'agent_proposal' AND proposal_id IS NULL)
  ),
  CONSTRAINT trip_versions_change_summary_array CHECK (jsonb_typeof(change_summary) = 'array'),
  CONSTRAINT trip_versions_reversibility_evidence CHECK (
    (inverse_operation IS NOT NULL AND non_reversible_reason IS NULL)
    OR (inverse_operation IS NULL AND char_length(btrim(non_reversible_reason)) > 0)
  ),
  CONSTRAINT trip_versions_request_unique UNIQUE (trip_id, initiating_request_id)
);

CREATE TABLE app.conversations (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES app."user" (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL,
  CONSTRAINT conversations_retention_after_creation CHECK (retention_expires_at > created_at)
);

CREATE INDEX conversations_trip_updated_idx ON app.conversations (trip_id, updated_at DESC);

CREATE TABLE app.conversation_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES app.conversations (id) ON DELETE CASCADE,
  role text NOT NULL,
  content jsonb NOT NULL,
  trip_version integer,
  agent_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL,
  CONSTRAINT conversation_messages_role_valid CHECK (role IN ('user', 'assistant', 'system')),
  CONSTRAINT conversation_messages_content_object CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT conversation_messages_trip_version_positive CHECK (trip_version IS NULL OR trip_version > 0),
  CONSTRAINT conversation_messages_retention_after_creation CHECK (retention_expires_at > created_at)
);

CREATE INDEX conversation_messages_replay_idx
  ON app.conversation_messages (conversation_id, created_at, id);
CREATE INDEX conversation_messages_retention_idx
  ON app.conversation_messages (retention_expires_at);

CREATE TABLE app.conversation_summaries (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES app.conversations (id) ON DELETE CASCADE,
  summary_version integer NOT NULL,
  content jsonb NOT NULL,
  first_message_id uuid NOT NULL REFERENCES app.conversation_messages (id) ON DELETE RESTRICT,
  last_message_id uuid NOT NULL REFERENCES app.conversation_messages (id) ON DELETE RESTRICT,
  source_trip_version integer NOT NULL,
  token_estimate integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, summary_version),
  CONSTRAINT conversation_summaries_version_positive CHECK (summary_version > 0),
  CONSTRAINT conversation_summaries_content_object CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT conversation_summaries_trip_version_positive CHECK (source_trip_version > 0),
  CONSTRAINT conversation_summaries_token_estimate_nonnegative CHECK (token_estimate >= 0)
);

CREATE TABLE app.outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  event_version integer NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivery_state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error_category text,
  CONSTRAINT outbox_event_type_not_blank CHECK (btrim(event_type) <> ''),
  CONSTRAINT outbox_event_version_positive CHECK (event_version > 0),
  CONSTRAINT outbox_aggregate_version_positive CHECK (aggregate_version > 0),
  CONSTRAINT outbox_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox_delivery_state_valid CHECK (
    delivery_state IN ('pending', 'delivering', 'delivered', 'failed')
  ),
  CONSTRAINT outbox_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT outbox_delivered_timestamp_consistent CHECK (
    (delivery_state = 'delivered' AND delivered_at IS NOT NULL)
    OR (delivery_state <> 'delivered' AND delivered_at IS NULL)
  ),
  UNIQUE (event_type, event_version, aggregate_id, aggregate_version)
);

CREATE INDEX outbox_delivery_idx
  ON app.outbox_events (next_attempt_at, created_at)
  WHERE delivery_state IN ('pending', 'failed');
CREATE INDEX outbox_lease_idx
  ON app.outbox_events (lease_expires_at)
  WHERE delivery_state = 'delivering';

CREATE TABLE app.idempotency_records (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  state text NOT NULL,
  result_reference jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, idempotency_key),
  CONSTRAINT idempotency_scope_not_blank CHECK (btrim(scope) <> ''),
  CONSTRAINT idempotency_key_not_blank CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT idempotency_fingerprint_sha256 CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT idempotency_state_valid CHECK (state IN ('in_progress', 'completed', 'unknown')),
  CONSTRAINT idempotency_result_reference_object CHECK (
    result_reference IS NULL OR jsonb_typeof(result_reference) = 'object'
  ),
  CONSTRAINT idempotency_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT idempotency_completed_has_result CHECK (
    state <> 'completed' OR result_reference IS NOT NULL
  )
);

CREATE INDEX idempotency_expiry_idx ON app.idempotency_records (expires_at);

CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  request_id uuid NOT NULL,
  trace_id text,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_actor_type_valid CHECK (actor_type IN ('user', 'service', 'system')),
  CONSTRAINT audit_action_not_blank CHECK (btrim(action) <> ''),
  CONSTRAINT audit_target_not_blank CHECK (btrim(target_type) <> '' AND btrim(target_id) <> ''),
  CONSTRAINT audit_outcome_valid CHECK (outcome IN ('allowed', 'denied', 'succeeded', 'failed')),
  CONSTRAINT audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_target_time_idx ON app.audit_events (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_request_idx ON app.audit_events (request_id);

CREATE FUNCTION app.reject_immutable_record_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER trip_versions_immutable
  BEFORE UPDATE OR DELETE ON app.trip_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON app.audit_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();

CREATE FUNCTION app.guard_idempotency_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scope <> OLD.scope
    OR NEW.idempotency_key <> OLD.idempotency_key
    OR NEW.request_fingerprint <> OLD.request_fingerprint
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'idempotency identity or fingerprint cannot change' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER idempotency_identity_immutable
  BEFORE UPDATE ON app.idempotency_records
  FOR EACH ROW EXECUTE FUNCTION app.guard_idempotency_identity();

REVOKE UPDATE, DELETE ON app.trip_versions, app.audit_events
  FROM onholidai_web, onholidai_worker;
GRANT SELECT, INSERT ON app.trip_versions, app.audit_events
  TO onholidai_web, onholidai_worker;

-- Require valid reversibility evidence for every trip version.
-- Validation deliberately fails if existing immutable rows lack valid evidence;
-- do not fabricate reversibility metadata or rewrite historical snapshots.
ALTER TABLE app.trip_versions
  DROP CONSTRAINT trip_versions_reversibility_evidence,
  ADD CONSTRAINT trip_versions_reversibility_evidence CHECK (
    (
      inverse_operation IS NOT NULL
      AND non_reversible_reason IS NULL
      AND jsonb_typeof(inverse_operation) = 'object'
      AND inverse_operation ?& ARRAY['operation', 'target', 'value']
      AND (inverse_operation - ARRAY['operation', 'target', 'value']) = '{}'::jsonb
      AND jsonb_typeof(inverse_operation -> 'operation') = 'string'
      AND inverse_operation ->> 'operation' IN ('add', 'replace', 'remove', 'reorder')
      AND jsonb_typeof(inverse_operation -> 'target') = 'string'
      AND inverse_operation ->> 'target' ~ '^/(departureOrigin|availabilityWindows|duration|travellerParty|preferences|constraints|destinations|itineraryDays|components|price|warnings)(/.*)?$'
    )
    OR (
      inverse_operation IS NULL
      AND non_reversible_reason IS NOT NULL
      AND char_length(btrim(non_reversible_reason, E' \t\n\r\f' || chr(11))) BETWEEN 1 AND 1000
    )
  );

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

-- Align foundation constraints with current team roles and undo operations.
--
-- 1. internal_team_role was limited to the original operational vocabulary, but the
--    pricing diagnostic boundary authorizes pricing_auditor and administrator
--    (web/server/auth/authorize.ts and the web API contracts).
-- 2. The reversibility-evidence target allowlist omitted the root path. Domain
--    inverse operations use draftOperationSchema, which permits a whole-snapshot
--    restore (target "/") in addition to the concrete draft fields.
ALTER TABLE app."user"
  DROP CONSTRAINT user_internal_team_role_valid,
  ADD CONSTRAINT user_internal_team_role_valid CHECK (
    internal_team_role IS NULL
    OR internal_team_role IN ('support', 'operations', 'admin', 'pricing_auditor', 'administrator')
  );

ALTER TABLE app.trip_versions
  DROP CONSTRAINT trip_versions_reversibility_evidence,
  ADD CONSTRAINT trip_versions_reversibility_evidence CHECK (
    (
      inverse_operation IS NOT NULL
      AND non_reversible_reason IS NULL
      AND jsonb_typeof(inverse_operation) = 'object'
      AND inverse_operation ?& ARRAY['operation', 'target', 'value']
      AND (inverse_operation - ARRAY['operation', 'target', 'value']) = '{}'::jsonb
      AND jsonb_typeof(inverse_operation -> 'operation') = 'string'
      AND inverse_operation ->> 'operation' IN ('add', 'replace', 'remove', 'reorder')
      AND jsonb_typeof(inverse_operation -> 'target') = 'string'
      AND inverse_operation ->> 'target' ~ '^/((departureOrigin|availabilityWindows|duration|travellerParty|preferences|constraints|destinations|itineraryDays|components|price|warnings)(/.*)?)?$'
    )
    OR (
      inverse_operation IS NULL
      AND non_reversible_reason IS NOT NULL
      AND char_length(btrim(non_reversible_reason, E' \t\n\r\f' || chr(11))) BETWEEN 1 AND 1000
    )
  );

-- Persist reviewed draft edits alongside agent proposals.
CREATE TABLE app.draft_edit_reviews (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES app.trips(id),
  owner_user_id text NOT NULL,
  base_trip_version integer NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  operations jsonb NOT NULL,
  review jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(trip_id, base_trip_version) REFERENCES app.trip_versions(trip_id, version)
);
CREATE INDEX draft_edit_reviews_scope ON app.draft_edit_reviews(trip_id, owner_user_id, expires_at);
ALTER TABLE app.change_proposals ADD CONSTRAINT refinement_review_required CHECK
  (purpose <> 'refinement' OR (proposal ? 'previewSnapshot' AND proposal ? 'priceImpact' AND proposal ? 'scheduleImpact'));
ALTER TABLE app.agent_runs ADD COLUMN dispatch_request jsonb;

CREATE TABLE app.booking_revalidations (
  workflow_id text PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  owner_user_id text NOT NULL REFERENCES app."user" (id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_fingerprint character(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  trip_version integer NOT NULL CHECK (trip_version > 0),
  status text NOT NULL CHECK (status IN ('accepted','running','completed','failed')),
  outcomes jsonb NOT NULL CHECK (jsonb_typeof(outcomes) = 'array'),
  terms jsonb CHECK (terms IS NULL OR jsonb_typeof(terms) = 'object'),
  terms_hash character(64),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, request_id),
  CHECK ((terms IS NULL AND terms_hash IS NULL) OR (terms IS NOT NULL AND terms_hash ~ '^[a-f0-9]{64}$'))
);

CREATE TABLE app.booking_authorizations (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  owner_user_id text NOT NULL REFERENCES app."user" (id) ON DELETE RESTRICT,
  trip_version integer NOT NULL CHECK (trip_version > 0),
  operation text NOT NULL CHECK (operation IN ('book_trip','reschedule_component','cancel_component')),
  component_id uuid,
  terms jsonb NOT NULL CHECK (jsonb_typeof(terms) = 'object'),
  terms_hash character(64) NOT NULL CHECK (terms_hash ~ '^[a-f0-9]{64}$'),
  acknowledged_non_reversible_actions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(acknowledged_non_reversible_actions) = 'array'),
  status text NOT NULL CHECK (status IN ('pending','authorized','invalidated','expired','consumed')),
  reason text,
  authorized_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((operation = 'book_trip' AND component_id IS NULL) OR (operation <> 'book_trip' AND component_id IS NOT NULL)),
  CHECK (expires_at > authorized_at),
  UNIQUE (trip_id, id, terms_hash)
);
CREATE INDEX booking_authorizations_owner_idx ON app.booking_authorizations (owner_user_id, trip_id, created_at DESC);

CREATE TABLE app.booking_transactions (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  owner_user_id text NOT NULL REFERENCES app."user" (id) ON DELETE RESTRICT,
  authorization_id uuid NOT NULL REFERENCES app.booking_authorizations (id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('book_trip','reschedule_component','cancel_component')),
  workflow_id text NOT NULL UNIQUE,
  request_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','running','partially_confirmed','confirmed','action_required','failed','cancelled')),
  components jsonb NOT NULL CHECK (jsonb_typeof(components) = 'array'),
  execution_basis jsonb NOT NULL CHECK (jsonb_typeof(execution_basis) = 'object'),
  last_observed_trip_version integer NOT NULL CHECK (last_observed_trip_version > 0),
  execution_status text NOT NULL CHECK (execution_status IN ('active','invalidated','expired','completed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (authorization_id),
  UNIQUE (trip_id, request_id)
);
CREATE INDEX booking_transactions_trip_idx ON app.booking_transactions (trip_id, started_at DESC);

CREATE TABLE app.booking_component_attempts (
  id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  component_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('book_trip','reschedule_component','cancel_component')),
  idempotency_key text NOT NULL,
  request_fingerprint character(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  provider_attempt integer NOT NULL CHECK (provider_attempt > 0),
  status text NOT NULL CHECK (status IN ('claimed','dispatched','confirmed','failed','unknown','reconciled')),
  provider_reference text,
  safe_reason text,
  status_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation, idempotency_key),
  UNIQUE (transaction_id, component_id, provider_attempt)
);
CREATE INDEX booking_attempts_reconcile_idx ON app.booking_component_attempts (trip_id, status, updated_at)
  WHERE status IN ('dispatched','unknown');

CREATE TABLE app.booking_write_claims (
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  component_id uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES app.booking_component_attempts (id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('claimed','unknown')),
  evidence jsonb CHECK (evidence IS NULL OR jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, component_id)
);

CREATE TABLE app.booking_confirmations (
  id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  component_id uuid NOT NULL,
  provider_reference text NOT NULL,
  terms jsonb NOT NULL CHECK (jsonb_typeof(terms) = 'object'),
  confirmed_at timestamptz NOT NULL,
  UNIQUE (transaction_id, component_id)
);

CREATE FUNCTION app.guard_booking_transaction_basis()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.trip_id <> OLD.trip_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.authorization_id <> OLD.authorization_id OR NEW.operation <> OLD.operation
    OR NEW.workflow_id <> OLD.workflow_id OR NEW.request_id <> OLD.request_id
    OR NEW.execution_basis IS DISTINCT FROM OLD.execution_basis OR NEW.started_at <> OLD.started_at
  THEN
    RAISE EXCEPTION 'booking execution basis is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER booking_transaction_basis_immutable
  BEFORE UPDATE ON app.booking_transactions
  FOR EACH ROW EXECUTE FUNCTION app.guard_booking_transaction_basis();
CREATE TRIGGER booking_transactions_no_delete
  BEFORE DELETE ON app.booking_transactions
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();

CREATE FUNCTION app.guard_booking_attempt_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.transaction_id <> OLD.transaction_id OR NEW.trip_id <> OLD.trip_id
    OR NEW.component_id <> OLD.component_id OR NEW.operation <> OLD.operation
    OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.request_fingerprint <> OLD.request_fingerprint
    OR NEW.provider_attempt <> OLD.provider_attempt OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'booking attempt identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER booking_attempt_identity_immutable
  BEFORE UPDATE ON app.booking_component_attempts
  FOR EACH ROW EXECUTE FUNCTION app.guard_booking_attempt_identity();
CREATE TRIGGER booking_attempts_no_delete
  BEFORE DELETE ON app.booking_component_attempts
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();

CREATE TABLE app.booking_version_evidence (
  trip_id uuid NOT NULL,
  trip_version integer NOT NULL,
  transaction_id uuid NOT NULL REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  material_terms_hash character(64) NOT NULL CHECK (material_terms_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, trip_version),
  FOREIGN KEY (trip_id, trip_version) REFERENCES app.trip_versions (trip_id, version) ON DELETE RESTRICT
);
CREATE TABLE app.booking_provider_callbacks (
  provider text NOT NULL CHECK (provider IN ('duffel','booking','getyourguide','trainline')),
  provider_event_id text NOT NULL,
  fingerprint character(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  transaction_id uuid NOT NULL REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  component_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('confirmed','failed','unknown','action_required')),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_event_id)
);
CREATE TRIGGER booking_provider_callbacks_immutable
  BEFORE UPDATE OR DELETE ON app.booking_provider_callbacks
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();
CREATE TRIGGER booking_version_evidence_immutable
  BEFORE UPDATE OR DELETE ON app.booking_version_evidence
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();

CREATE FUNCTION app.guard_booking_authorization_terms()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.trip_id <> OLD.trip_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.trip_version <> OLD.trip_version OR NEW.operation <> OLD.operation
    OR NEW.component_id IS DISTINCT FROM OLD.component_id OR NEW.terms IS DISTINCT FROM OLD.terms
    OR NEW.terms_hash <> OLD.terms_hash
    OR NEW.acknowledged_non_reversible_actions <> OLD.acknowledged_non_reversible_actions
    OR NEW.authorized_at <> OLD.authorized_at OR NEW.expires_at <> OLD.expires_at
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'booking authorization terms are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER booking_authorizations_immutable
  BEFORE UPDATE ON app.booking_authorizations
  FOR EACH ROW EXECUTE FUNCTION app.guard_booking_authorization_terms();
CREATE TRIGGER booking_authorizations_no_delete
  BEFORE DELETE ON app.booking_authorizations
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();
CREATE TRIGGER booking_confirmations_immutable
  BEFORE UPDATE OR DELETE ON app.booking_confirmations
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_record_change();

CREATE FUNCTION app.guard_booking_revalidation_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow_id <> OLD.workflow_id OR NEW.trip_id <> OLD.trip_id
    OR NEW.owner_user_id <> OLD.owner_user_id OR NEW.request_id <> OLD.request_id
    OR NEW.request_fingerprint <> OLD.request_fingerprint OR NEW.trip_version <> OLD.trip_version OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'booking revalidation identity cannot change' USING ERRCODE = '23505';
  END IF;
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'completed booking revalidation terms are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER booking_revalidation_identity_immutable
  BEFORE UPDATE ON app.booking_revalidations
  FOR EACH ROW EXECUTE FUNCTION app.guard_booking_revalidation_identity();

REVOKE DELETE ON app.booking_authorizations, app.booking_confirmations FROM onholidai_web, onholidai_worker;
GRANT SELECT, INSERT, UPDATE ON app.booking_authorizations TO onholidai_web, onholidai_worker;
GRANT SELECT, INSERT ON app.booking_confirmations TO onholidai_web, onholidai_worker;
GRANT SELECT, INSERT ON app.booking_version_evidence TO onholidai_web, onholidai_worker;
GRANT SELECT, INSERT ON app.booking_provider_callbacks TO onholidai_web, onholidai_worker;
GRANT SELECT, INSERT, UPDATE ON app.booking_revalidations, app.booking_transactions,
  app.booking_component_attempts, app.booking_write_claims TO onholidai_web, onholidai_worker;

CREATE TABLE app.privacy_legal_holds (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES app.trips (id) ON DELETE RESTRICT,
  owner_user_id text NOT NULL REFERENCES app."user" (id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_by text,
  released_at timestamptz,
  CONSTRAINT privacy_legal_holds_reason_code CHECK (reason_code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  CONSTRAINT privacy_legal_holds_release_pair CHECK (
    (released_by IS NULL AND released_at IS NULL)
    OR (released_by IS NOT NULL AND released_at IS NOT NULL AND released_at >= created_at)
  )
);

CREATE INDEX privacy_legal_holds_active_trip_idx ON app.privacy_legal_holds (trip_id)
  WHERE released_at IS NULL;
CREATE INDEX privacy_legal_holds_active_owner_idx ON app.privacy_legal_holds (owner_user_id)
  WHERE released_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON app.privacy_legal_holds TO onholidai_web;

CREATE TABLE app.trip_event_receipts (
  event_id uuid PRIMARY KEY,
  state text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT trip_event_receipts_state_valid CHECK (state IN ('claimed', 'completed')),
  CONSTRAINT trip_event_receipts_completion_consistent CHECK (
    (state = 'completed' AND completed_at IS NOT NULL)
    OR (state = 'claimed' AND completed_at IS NULL)
  )
);

CREATE INDEX trip_event_receipts_lease_idx ON app.trip_event_receipts (lease_expires_at)
  WHERE state = 'claimed';

GRANT SELECT, INSERT, UPDATE, DELETE ON app.trip_event_receipts TO onholidai_web;

-- Establish account and guest planning identities before dependent records.
CREATE TABLE app.guest_planning_sessions (
  id uuid PRIMARY KEY,
  credential_digest text NOT NULL UNIQUE CHECK (credential_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (last_activity_at >= created_at AND expires_at > last_activity_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX guest_planning_sessions_expiry ON app.guest_planning_sessions (expires_at);

CREATE TABLE app.planning_principals (
  id text PRIMARY KEY,
  account_user_id text REFERENCES app."user" (id) ON DELETE RESTRICT,
  guest_session_id uuid REFERENCES app.guest_planning_sessions (id) ON DELETE RESTRICT,
  origin_kind text NOT NULL CHECK (origin_kind IN ('account', 'guest')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  CHECK ((account_user_id IS NOT NULL)::integer + (guest_session_id IS NOT NULL)::integer = 1),
  CHECK (NOT is_default OR (origin_kind = 'account' AND id = account_user_id)),
  CHECK (origin_kind <> 'account' OR (account_user_id IS NOT NULL AND linked_at IS NULL)),
  CHECK (origin_kind <> 'guest' OR ((account_user_id IS NOT NULL) = (linked_at IS NOT NULL))),
  CHECK (linked_at IS NULL OR linked_at >= created_at)
);
CREATE UNIQUE INDEX planning_principals_account_default ON app.planning_principals (account_user_id) WHERE is_default;
CREATE INDEX planning_principals_guest ON app.planning_principals (guest_session_id);
CREATE INDEX planning_principals_account ON app.planning_principals (account_user_id);

INSERT INTO app.planning_principals (id, account_user_id, origin_kind, is_default)
  SELECT id, id, 'account', true FROM app."user";

-- Maintain compatibility for newly registered accounts and legacy direct creation.
CREATE FUNCTION app.allocate_account_planning_principal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app.planning_principals (id, account_user_id, origin_kind, is_default)
    VALUES (NEW.id, NEW.id, 'account', true);
  RETURN NEW;
END $$;
CREATE TRIGGER account_planning_principal AFTER INSERT ON app."user"
  FOR EACH ROW EXECUTE FUNCTION app.allocate_account_planning_principal();

ALTER TABLE app.trips DROP CONSTRAINT trips_owner_user_id_fkey;
ALTER TABLE app.trips ADD CONSTRAINT trips_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app.planning_principals (id) ON DELETE RESTRICT;
ALTER TABLE app.conversations DROP CONSTRAINT conversations_owner_user_id_fkey;
ALTER TABLE app.conversations ADD CONSTRAINT conversations_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app.planning_principals (id) ON DELETE RESTRICT;
ALTER TABLE app.privacy_legal_holds DROP CONSTRAINT privacy_legal_holds_owner_user_id_fkey;
ALTER TABLE app.privacy_legal_holds ADD CONSTRAINT privacy_legal_holds_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app.planning_principals (id) ON DELETE RESTRICT;

CREATE FUNCTION app.guard_planning_principal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.origin_kind, NEW.is_default, NEW.created_at) IS DISTINCT FROM
    (OLD.id, OLD.origin_kind, OLD.is_default, OLD.created_at) OR
    (OLD.account_user_id IS NOT NULL AND (NEW.account_user_id, NEW.guest_session_id, NEW.linked_at)
      IS DISTINCT FROM (OLD.account_user_id, OLD.guest_session_id, OLD.linked_at)) OR
    (OLD.account_user_id IS NULL AND NEW.account_user_id IS NULL AND
      NEW.guest_session_id IS DISTINCT FROM OLD.guest_session_id) THEN
    RAISE EXCEPTION 'planning identity and successful account binding are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planning_principal_identity BEFORE UPDATE ON app.planning_principals
  FOR EACH ROW EXECUTE FUNCTION app.guard_planning_principal();

CREATE FUNCTION app.guard_planning_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.credential_digest, NEW.created_at) IS DISTINCT FROM
    (OLD.id, OLD.credential_digest, OLD.created_at) OR
    (OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) OR
    NEW.last_activity_at < OLD.last_activity_at THEN
    RAISE EXCEPTION 'planning session cannot change identity or revive revoked authority' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planning_session_identity BEFORE UPDATE ON app.guest_planning_sessions
  FOR EACH ROW EXECUTE FUNCTION app.guard_planning_session();

GRANT SELECT, INSERT, UPDATE ON app.guest_planning_sessions, app.planning_principals TO onholidai_web;
GRANT SELECT ON app.guest_planning_sessions, app.planning_principals TO onholidai_worker;

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

ALTER TABLE app.booking_revalidations
  ADD COLUMN coverage jsonb CHECK (coverage IS NULL OR jsonb_typeof(coverage) = 'object'),
  ADD COLUMN terms_version integer GENERATED ALWAYS AS
    (CASE WHEN terms IS NULL THEN NULL WHEN terms ->> 'schemaVersion' = '2' THEN 2 ELSE 1 END) STORED;

ALTER TABLE app.booking_authorizations
  ADD COLUMN request_id uuid,
  ADD COLUMN request_fingerprint character(64),
  ADD COLUMN terms_version integer GENERATED ALWAYS AS
    (CASE WHEN terms ->> 'schemaVersion' = '2' THEN 2 ELSE 1 END) STORED,
  ADD COLUMN continuation_of uuid GENERATED ALWAYS AS ((terms ->> 'continuationOf')::uuid) STORED
    REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  ADD COLUMN root_attempt_id uuid GENERATED ALWAYS AS ((terms ->> 'rootAttemptId')::uuid) STORED
    REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  ADD CONSTRAINT booking_authorization_request_identity CHECK
    ((request_id IS NULL AND request_fingerprint IS NULL) OR
     (request_id IS NOT NULL AND request_fingerprint ~ '^[a-f0-9]{64}$')),
  ADD CONSTRAINT booking_authorization_v2_request CHECK
    (terms_version <> 2 OR (request_id IS NOT NULL AND request_fingerprint IS NOT NULL)),
  ADD CONSTRAINT booking_authorization_terms_version CHECK
    (NOT (terms ? 'schemaVersion') OR terms -> 'schemaVersion' = '2'::jsonb),
  ADD CONSTRAINT booking_authorization_lineage CHECK
    ((continuation_of IS NULL) = (root_attempt_id IS NULL));
CREATE UNIQUE INDEX booking_authorization_request_idx
  ON app.booking_authorizations (owner_user_id, trip_id, request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE app.booking_transactions
  ADD COLUMN terms_version integer GENERATED ALWAYS AS
    (CASE WHEN execution_basis #>> '{terms,schemaVersion}' = '2' THEN 2 ELSE 1 END) STORED,
  ADD COLUMN continuation_of uuid GENERATED ALWAYS AS
    ((execution_basis #>> '{terms,continuationOf}')::uuid) STORED
    REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  ADD COLUMN root_attempt_id uuid GENERATED ALWAYS AS
    ((execution_basis #>> '{terms,rootAttemptId}')::uuid) STORED
    REFERENCES app.booking_transactions (id) ON DELETE RESTRICT,
  ADD CONSTRAINT booking_transaction_lineage CHECK
    ((continuation_of IS NULL) = (root_attempt_id IS NULL));
CREATE INDEX booking_transaction_root_idx
  ON app.booking_transactions (trip_id, root_attempt_id, started_at DESC)
  WHERE root_attempt_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.guard_booking_authorization_terms()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.trip_id <> OLD.trip_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.trip_version <> OLD.trip_version OR NEW.operation <> OLD.operation
    OR NEW.component_id IS DISTINCT FROM OLD.component_id OR NEW.terms IS DISTINCT FROM OLD.terms
    OR NEW.terms_hash <> OLD.terms_hash
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.acknowledged_non_reversible_actions <> OLD.acknowledged_non_reversible_actions
    OR NEW.authorized_at <> OLD.authorized_at OR NEW.expires_at <> OLD.expires_at
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'booking authorization terms are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION app.guard_booking_revalidation_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.workflow_id, NEW.trip_id, NEW.owner_user_id, NEW.request_id,
         NEW.request_fingerprint, NEW.trip_version, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.workflow_id, OLD.trip_id, OLD.owner_user_id, OLD.request_id,
         OLD.request_fingerprint, OLD.trip_version, OLD.created_at)
  THEN
    RAISE EXCEPTION 'booking revalidation identity cannot change' USING ERRCODE = '23505';
  END IF;
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION '% booking revalidation terms are immutable', OLD.status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE app.booking_component_attempts
  ADD COLUMN requirement_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN provider_evidence jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(provider_evidence) = 'array'),
  ADD COLUMN evidence_conflict boolean NOT NULL DEFAULT false;

UPDATE app.booking_component_attempts AS attempt
SET requirement_ids = ARRAY(
  SELECT jsonb_array_elements_text(component->'evidence'->'requirementIds')
  FROM app.booking_transactions AS booking,
    jsonb_array_elements(booking.execution_basis->'terms'->'components') AS component
  WHERE booking.id = attempt.transaction_id
    AND component->>'componentId' = attempt.component_id::text
    AND jsonb_typeof(component->'evidence'->'requirementIds') = 'array'
);

CREATE INDEX booking_attempt_requirements_idx
  ON app.booking_component_attempts USING gin (requirement_ids);

ALTER TABLE app.booking_component_attempts
  ADD CONSTRAINT booking_attempt_claim_identity UNIQUE (id, transaction_id, trip_id, component_id);
ALTER TABLE app.booking_write_claims
  ADD CONSTRAINT booking_claim_attempt_scope
    FOREIGN KEY (attempt_id, transaction_id, trip_id, component_id)
    REFERENCES app.booking_component_attempts (id, transaction_id, trip_id, component_id)
    ON DELETE RESTRICT;

CREATE FUNCTION app.guard_booking_attempt_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requirement_ids IS DISTINCT FROM OLD.requirement_ids
    OR (OLD.evidence_conflict AND NOT NEW.evidence_conflict)
    OR jsonb_array_length(NEW.provider_evidence) < jsonb_array_length(OLD.provider_evidence)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(OLD.provider_evidence) WITH ORDINALITY AS item(value, position)
      WHERE NEW.provider_evidence->(item.position::integer - 1) IS DISTINCT FROM item.value
    )
  THEN
    RAISE EXCEPTION 'booking attempt evidence is append-only' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('dispatched','confirmed','unknown','reconciled','failed')
    AND NEW.status = 'claimed'
  THEN
    RAISE EXCEPTION 'a dispatched booking attempt cannot be reclaimed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER booking_attempt_evidence_immutable
  BEFORE UPDATE ON app.booking_component_attempts
  FOR EACH ROW EXECUTE FUNCTION app.guard_booking_attempt_evidence();

CREATE FUNCTION app.guard_booking_attempt_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  terms jsonb;
  parent_id uuid;
  root_id uuid;
  parent app.booking_transactions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'booking_authorizations' THEN
    terms := NEW.terms;
  ELSE
    terms := NEW.execution_basis->'terms';
  END IF;
  parent_id := (terms->>'continuationOf')::uuid;
  root_id := (terms->>'rootAttemptId')::uuid;
  IF parent_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO parent FROM app.booking_transactions WHERE id = parent_id;
  IF NOT FOUND OR parent.trip_id <> NEW.trip_id OR parent.owner_user_id <> NEW.owner_user_id
    OR parent.operation <> 'book_trip'
    OR root_id IS DISTINCT FROM coalesce(parent.root_attempt_id, parent.id)
    OR (TG_TABLE_NAME = 'booking_transactions' AND parent_id = NEW.id)
  THEN
    RAISE EXCEPTION 'booking continuation lineage is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER booking_authorization_lineage_guard
  BEFORE INSERT ON app.booking_authorizations
  FOR EACH ROW EXECUTE FUNCTION app.guard_booking_attempt_lineage();
CREATE TRIGGER booking_transaction_lineage_guard
  BEFORE INSERT ON app.booking_transactions
  FOR EACH ROW EXECUTE FUNCTION app.guard_booking_attempt_lineage();

ALTER TABLE app.outbox_events
  DROP CONSTRAINT outbox_events_event_type_event_version_aggregate_id_aggrega_key;

-- A fresh whole-trip review or continuation need not change the accepted trip version.
CREATE UNIQUE INDEX outbox_trip_version_identity
  ON app.outbox_events (event_type, event_version, aggregate_id, aggregate_version)
  WHERE event_type NOT IN (
    'booking.revalidation.requested',
    'booking.reschedule.revalidation.requested',
    'booking.transaction.requested'
  );

ALTER TABLE app.outbox_events
  ADD CONSTRAINT outbox_booking_workflow_required CHECK (
    event_type NOT IN (
      'booking.revalidation.requested',
      'booking.reschedule.revalidation.requested',
      'booking.transaction.requested'
    )
    OR coalesce(
      jsonb_typeof(payload->'workflowId') = 'string'
      AND length(btrim(payload->>'workflowId')) BETWEEN 1 AND 256,
      false
    )
  );

CREATE UNIQUE INDEX outbox_booking_workflow_identity
  ON app.outbox_events (event_type, event_version, (payload->>'workflowId'))
  WHERE event_type IN (
    'booking.revalidation.requested',
    'booking.reschedule.revalidation.requested',
    'booking.transaction.requested'
  );

-- An unexpected agent error is recorded as agent_error, so only a web-rejected
-- proposal keeps the invalid_result category that claims unusable supplier evidence.
ALTER TABLE app.agent_runs DROP CONSTRAINT agent_runs_error_category_check;
ALTER TABLE app.agent_runs ADD CONSTRAINT agent_runs_error_category_check
  CHECK (error_category IN ('interrupted', 'deadline', 'source_unavailable', 'invalid_result', 'agent_error'));
