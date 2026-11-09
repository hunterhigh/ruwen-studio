CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), locale text NOT NULL DEFAULT 'zh-CN');
CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, provider text NOT NULL, account_id text NOT NULL);
CREATE UNIQUE INDEX accounts_provider_account ON accounts(provider, account_id);
CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users, project_key text NOT NULL, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), upstream_version text NOT NULL DEFAULT '5.0.0');
CREATE TABLE project_files (project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE, path text NOT NULL CHECK(path <> ''), content bytea NOT NULL, sha256 text GENERATED ALWAYS AS (encode(sha256(content),'hex')) STORED, size integer GENERATED ALWAYS AS (octet_length(content)) STORED, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,path));
CREATE TABLE project_file_history (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE, path text NOT NULL, sha256 text NOT NULL, content bytea NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), cause_event_id text);
CREATE FUNCTION ruwen_file_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'DELETE' OR OLD.content IS DISTINCT FROM NEW.content THEN
  INSERT INTO project_file_history(project_id,path,sha256,content,cause_event_id) VALUES(OLD.project_id,OLD.path,OLD.sha256,OLD.content,nullif(current_setting('ruwen.cause_event_id', true),''));
 END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $$;
CREATE TRIGGER file_history BEFORE UPDATE OR DELETE ON project_files FOR EACH ROW EXECUTE FUNCTION ruwen_file_history();
CREATE TABLE approval_events (id text NOT NULL, project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE, event_path text NOT NULL, action text NOT NULL, target_path text NOT NULL, target_sha256 text NOT NULL, created_by uuid NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz, PRIMARY KEY(project_id,id));
CREATE UNIQUE INDEX approval_event_path ON approval_events(project_id,event_path);
CREATE TABLE pipeline_runs (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE, kind text NOT NULL, chapter text, status text NOT NULL, request jsonb NOT NULL, cancel_requested boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE TABLE pipeline_steps (run_id uuid NOT NULL REFERENCES pipeline_runs ON DELETE CASCADE, step text NOT NULL, status text NOT NULL, input_ref jsonb, output_ref jsonb, error text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, PRIMARY KEY(run_id,step));
CREATE TABLE prompts (sha256 text PRIMARY KEY, content text NOT NULL);
CREATE TABLE role_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES pipeline_runs ON DELETE CASCADE, role_id text NOT NULL, status text NOT NULL, input_sha256 text NOT NULL, model text, prompt_sha256 text REFERENCES prompts, result jsonb, transcript jsonb, usage jsonb, cost_usd numeric(20,10), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE UNIQUE INDEX role_run_once ON role_runs(run_id,role_id);
CREATE TABLE ideation_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE, session_id uuid NOT NULL, role text NOT NULL, content jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE previews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE, kind text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE credit_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users, delta_credits bigint NOT NULL, reason text NOT NULL, ref_type text NOT NULL, ref_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX credit_ledger_ref ON credit_ledger(user_id,reason,ref_type,ref_id);
CREATE FUNCTION ruwen_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'credit_ledger is append-only'; END $$;
CREATE TRIGGER credit_append_only BEFORE UPDATE OR DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION ruwen_append_only();
CREATE TABLE credit_reservations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users, run_id uuid NOT NULL REFERENCES pipeline_runs, amount bigint NOT NULL CHECK(amount>=0), status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE subscriptions (user_id uuid PRIMARY KEY REFERENCES users, provider text NOT NULL, external_id text NOT NULL, plan text NOT NULL, status text NOT NULL, current_period_end timestamptz);
CREATE TABLE payment_events (provider text NOT NULL, external_event_id text NOT NULL, payload jsonb NOT NULL, processed_at timestamptz, PRIMARY KEY(provider,external_event_id));
CREATE TABLE role_cost_events (role_run_id uuid PRIMARY KEY REFERENCES role_runs, cost_usd numeric(20,10) NOT NULL CHECK(cost_usd>=0), created_at timestamptz NOT NULL DEFAULT now());
