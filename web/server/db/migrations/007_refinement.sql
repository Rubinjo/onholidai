-- Extend common proposal ownership; never rewrite an applied migration.
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
