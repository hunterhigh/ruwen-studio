CREATE TABLE security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES pipeline_runs ON DELETE CASCADE,
 role_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('canary','prompt_overlap','internal_refusal','content_refusal')),
 score integer NOT NULL CHECK(score=1),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX security_event_once ON security_events(run_id,role_id,kind);
