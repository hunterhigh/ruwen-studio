ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN image text;
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  account_id text NOT NULL, provider_id text NOT NULL, access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, password text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id,account_id)
);
CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL, value text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier ON auth_verifications(identifier);
CREATE TABLE web_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
  max_uses integer NOT NULL CHECK(max_uses>0), uses integer NOT NULL DEFAULT 0 CHECK(uses>=0),
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_invite_grants (
  email text PRIMARY KEY, invitation_id uuid NOT NULL REFERENCES web_invitations,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_run_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES pipeline_runs ON DELETE CASCADE,
  role_id text NOT NULL, delta text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_run_events_replay ON web_run_events(project_id,run_id,id);
CREATE TABLE web_rate_limits (
  key_hash text PRIMARY KEY, window_started_at timestamptz NOT NULL DEFAULT now(), attempts bigint NOT NULL DEFAULT 1
);
