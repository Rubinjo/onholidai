-- Corrective migration for two foundation constraints that no longer matched the
-- authoritative domain definitions. Applied migrations 001-005 are left untouched;
-- the corrective changes are applied additively here.
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
