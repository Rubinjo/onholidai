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
