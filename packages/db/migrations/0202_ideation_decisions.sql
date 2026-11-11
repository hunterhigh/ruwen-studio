CREATE TABLE ideation_decisions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, session_id uuid NOT NULL, preview_id uuid NOT NULL UNIQUE,
 receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,session_id,preview_id) REFERENCES ideation_previews(project_id,session_id,id)
);
ALTER TABLE ideation_tasks ADD CONSTRAINT ideation_task_source_preview
 FOREIGN KEY(project_id,session_id,source_preview_id) REFERENCES ideation_previews(project_id,session_id,id);
CREATE FUNCTION ruwen_immutable_ideation_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Ideation decision receipt is immutable'; END $$;
CREATE TRIGGER ideation_decision_immutable BEFORE UPDATE ON ideation_decisions FOR EACH ROW EXECUTE FUNCTION ruwen_immutable_ideation_decision();
