-- Separate from web authentication sessions. No project files contain coordinator wording.
CREATE TABLE ideation_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
 ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 title text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0), current_turn_id uuid REFERENCES pipeline_runs,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id)
);
-- Legacy unassociated rows are preserved; all new service rows require a real parent.
ALTER TABLE ideation_messages ADD COLUMN ordinal bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE ideation_messages ADD COLUMN turn_id uuid REFERENCES pipeline_runs;
ALTER TABLE ideation_messages ADD COLUMN status text NOT NULL DEFAULT 'complete';
ALTER TABLE ideation_messages ADD COLUMN session_revision integer;
ALTER TABLE ideation_messages ADD CONSTRAINT ideation_message_role CHECK(role IN ('user','assistant')) NOT VALID;
ALTER TABLE ideation_messages ADD CONSTRAINT ideation_message_status CHECK(status IN ('complete','streaming','failed')) NOT VALID;
ALTER TABLE ideation_messages ADD CONSTRAINT ideation_message_session FOREIGN KEY(project_id,session_id) REFERENCES ideation_sessions(project_id,id) NOT VALID;
CREATE INDEX ideation_messages_page ON ideation_messages(project_id,session_id,ordinal);
CREATE TABLE ideation_tasks (
 run_id uuid PRIMARY KEY REFERENCES pipeline_runs ON DELETE CASCADE,
 project_id uuid NOT NULL, session_id uuid NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 role text NOT NULL, stage text NOT NULL, source_preview_id uuid,
 output_preview_ids jsonb NOT NULL DEFAULT '[]', session_revision integer NOT NULL,
 error jsonb,
 FOREIGN KEY(project_id,session_id) REFERENCES ideation_sessions(project_id,id),
 UNIQUE(project_id,session_id,run_id)
);
CREATE TABLE ideation_requests (
 user_id uuid NOT NULL REFERENCES users, project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
 operation text NOT NULL, request_id uuid NOT NULL, request_sha256 text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(user_id,project_id,operation,request_id)
);
CREATE TABLE ideation_outbox (
 run_id uuid PRIMARY KEY REFERENCES ideation_tasks(run_id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ideation_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id uuid NOT NULL, session_id uuid NOT NULL, run_id uuid REFERENCES ideation_tasks(run_id),
 data jsonb NOT NULL CHECK(data->>'type' IN ('delta','reset','message_changed','task_changed','preview_changed','approval_committed','error')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,session_id) REFERENCES ideation_sessions(project_id,id),
 FOREIGN KEY(project_id,session_id,run_id) REFERENCES ideation_tasks(project_id,session_id,run_id)
);
CREATE INDEX ideation_events_page ON ideation_events(project_id,session_id,id);
CREATE FUNCTION ruwen_ideation_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_notify('ruwen_runs',json_build_object('projectId',NEW.project_id,'runId',NEW.run_id)::text);
 RETURN NEW; END $$;
CREATE TRIGGER ideation_event_notify AFTER INSERT ON ideation_events FOR EACH ROW EXECUTE FUNCTION ruwen_ideation_event();
