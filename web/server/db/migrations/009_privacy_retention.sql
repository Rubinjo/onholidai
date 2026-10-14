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
