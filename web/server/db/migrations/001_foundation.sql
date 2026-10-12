CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
DECLARE
  required_role text;
BEGIN
  FOREACH required_role IN ARRAY ARRAY[
    'onholidai_migration',
    'onholidai_web',
    'onholidai_worker'
  ]
  LOOP
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = required_role) THEN
      RAISE EXCEPTION 'Required database role % does not exist', required_role;
    END IF;
  END LOOP;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION onholidai_migration;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO onholidai_web, onholidai_worker;

CREATE TABLE app."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  locale text NOT NULL DEFAULT 'en-GB',
  default_currency text NOT NULL DEFAULT 'GBP',
  internal_team_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_locale_not_blank CHECK (btrim(locale) <> ''),
  CONSTRAINT user_default_currency_iso CHECK (default_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT user_internal_team_role_valid CHECK (
    internal_team_role IS NULL
    OR internal_team_role IN ('support', 'operations', 'admin')
  )
);

CREATE TABLE app.session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES app."user" (id) ON DELETE CASCADE
);

CREATE INDEX session_user_id_idx ON app.session (user_id);
CREATE INDEX session_expires_at_idx ON app.session (expires_at);

CREATE TABLE app.account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES app."user" (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_provider_identity_unique UNIQUE (provider_id, account_id)
);

CREATE INDEX account_user_id_idx ON app.account (user_id);

CREATE TABLE app.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_identifier_idx ON app.verification (identifier);
CREATE INDEX verification_expires_at_idx ON app.verification (expires_at);

CREATE TABLE app.spatial_places (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  location geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE app.spatial_routes (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  route geography(LineString, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX spatial_places_location_gist
  ON app.spatial_places USING GIST (location);

CREATE INDEX spatial_routes_route_gist
  ON app.spatial_routes USING GIST (route);

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA app
  TO onholidai_web, onholidai_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO onholidai_web, onholidai_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO onholidai_web, onholidai_worker;
