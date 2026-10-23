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
