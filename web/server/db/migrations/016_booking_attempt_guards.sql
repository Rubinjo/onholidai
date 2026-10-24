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
