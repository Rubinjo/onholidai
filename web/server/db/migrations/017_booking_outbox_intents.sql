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
