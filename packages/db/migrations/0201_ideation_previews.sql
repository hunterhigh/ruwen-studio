ALTER TABLE ideation_outbox ADD COLUMN queue_name text NOT NULL DEFAULT 'ruwen-work';
CREATE TABLE ideation_previews (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, session_id uuid NOT NULL, task_id uuid NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE, kind text NOT NULL,
 snapshot text NOT NULL, sha256 text NOT NULL CHECK(sha256=encode(sha256(convert_to(snapshot,'UTF8')),'hex')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','stale','superseded')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,session_id,task_id) REFERENCES ideation_tasks(project_id,session_id,run_id),
 UNIQUE(project_id,session_id,id)
);
CREATE FUNCTION ruwen_immutable_ideation_preview() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.project_id,NEW.session_id,NEW.task_id,NEW.kind,NEW.snapshot,NEW.sha256,NEW.ordinal,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.session_id,OLD.task_id,OLD.kind,OLD.snapshot,OLD.sha256,OLD.ordinal,OLD.created_at)
 THEN RAISE EXCEPTION 'Ideation preview executable snapshot is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER ideation_preview_immutable BEFORE UPDATE ON ideation_previews FOR EACH ROW EXECUTE FUNCTION ruwen_immutable_ideation_preview();
