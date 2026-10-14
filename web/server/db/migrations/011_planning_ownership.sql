-- Additive ownership transition: preserve all existing owner keys and evidence.
CREATE TABLE app.guest_planning_sessions (
  id uuid PRIMARY KEY,
  credential_digest text NOT NULL UNIQUE CHECK (credential_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (last_activity_at >= created_at AND expires_at > last_activity_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX guest_planning_sessions_expiry ON app.guest_planning_sessions (expires_at);

CREATE TABLE app.planning_principals (
  id text PRIMARY KEY,
  account_user_id text REFERENCES app."user" (id) ON DELETE RESTRICT,
  guest_session_id uuid REFERENCES app.guest_planning_sessions (id) ON DELETE RESTRICT,
  origin_kind text NOT NULL CHECK (origin_kind IN ('account', 'guest')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  CHECK ((account_user_id IS NOT NULL)::integer + (guest_session_id IS NOT NULL)::integer = 1),
  CHECK (NOT is_default OR (origin_kind = 'account' AND id = account_user_id)),
  CHECK (origin_kind <> 'account' OR (account_user_id IS NOT NULL AND linked_at IS NULL)),
  CHECK (origin_kind <> 'guest' OR ((account_user_id IS NOT NULL) = (linked_at IS NOT NULL))),
  CHECK (linked_at IS NULL OR linked_at >= created_at)
);
CREATE UNIQUE INDEX planning_principals_account_default ON app.planning_principals (account_user_id) WHERE is_default;
CREATE INDEX planning_principals_guest ON app.planning_principals (guest_session_id);
CREATE INDEX planning_principals_account ON app.planning_principals (account_user_id);

INSERT INTO app.planning_principals (id, account_user_id, origin_kind, is_default)
  SELECT id, id, 'account', true FROM app."user";

-- Maintain compatibility for newly registered accounts and legacy direct creation.
CREATE FUNCTION app.allocate_account_planning_principal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app.planning_principals (id, account_user_id, origin_kind, is_default)
    VALUES (NEW.id, NEW.id, 'account', true);
  RETURN NEW;
END $$;
CREATE TRIGGER account_planning_principal AFTER INSERT ON app."user"
  FOR EACH ROW EXECUTE FUNCTION app.allocate_account_planning_principal();

ALTER TABLE app.trips DROP CONSTRAINT trips_owner_user_id_fkey;
ALTER TABLE app.trips ADD CONSTRAINT trips_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app.planning_principals (id) ON DELETE RESTRICT;
ALTER TABLE app.conversations DROP CONSTRAINT conversations_owner_user_id_fkey;
ALTER TABLE app.conversations ADD CONSTRAINT conversations_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app.planning_principals (id) ON DELETE RESTRICT;
ALTER TABLE app.privacy_legal_holds DROP CONSTRAINT privacy_legal_holds_owner_user_id_fkey;
ALTER TABLE app.privacy_legal_holds ADD CONSTRAINT privacy_legal_holds_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES app.planning_principals (id) ON DELETE RESTRICT;

CREATE FUNCTION app.guard_planning_principal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.origin_kind, NEW.is_default, NEW.created_at) IS DISTINCT FROM
    (OLD.id, OLD.origin_kind, OLD.is_default, OLD.created_at) OR
    (OLD.account_user_id IS NOT NULL AND (NEW.account_user_id, NEW.guest_session_id, NEW.linked_at)
      IS DISTINCT FROM (OLD.account_user_id, OLD.guest_session_id, OLD.linked_at)) OR
    (OLD.account_user_id IS NULL AND NEW.account_user_id IS NULL AND
      NEW.guest_session_id IS DISTINCT FROM OLD.guest_session_id) THEN
    RAISE EXCEPTION 'planning identity and successful account binding are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planning_principal_identity BEFORE UPDATE ON app.planning_principals
  FOR EACH ROW EXECUTE FUNCTION app.guard_planning_principal();

CREATE FUNCTION app.guard_planning_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.credential_digest, NEW.created_at) IS DISTINCT FROM
    (OLD.id, OLD.credential_digest, OLD.created_at) OR
    (OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) OR
    NEW.last_activity_at < OLD.last_activity_at THEN
    RAISE EXCEPTION 'planning session cannot change identity or revive revoked authority' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planning_session_identity BEFORE UPDATE ON app.guest_planning_sessions
  FOR EACH ROW EXECUTE FUNCTION app.guard_planning_session();

GRANT SELECT, INSERT, UPDATE ON app.guest_planning_sessions, app.planning_principals TO onholidai_web;
GRANT SELECT ON app.guest_planning_sessions, app.planning_principals TO onholidai_worker;
