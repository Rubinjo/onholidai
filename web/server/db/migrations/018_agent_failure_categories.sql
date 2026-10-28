-- An unexpected agent error is recorded as agent_error, so only a web-rejected
-- proposal keeps the invalid_result category that claims unusable supplier evidence.
ALTER TABLE app.agent_runs DROP CONSTRAINT agent_runs_error_category_check;
ALTER TABLE app.agent_runs ADD CONSTRAINT agent_runs_error_category_check
  CHECK (error_category IN ('interrupted', 'deadline', 'source_unavailable', 'invalid_result', 'agent_error'));
