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
