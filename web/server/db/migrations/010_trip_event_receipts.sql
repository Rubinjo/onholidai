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
