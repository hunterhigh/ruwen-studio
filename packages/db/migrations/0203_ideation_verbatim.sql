ALTER TABLE ideation_previews ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE ideation_previews ADD CONSTRAINT ideation_preview_origin
 CHECK ((kind='verbatim') = (task_id IS NULL));
ALTER TABLE ideation_previews ADD CONSTRAINT ideation_preview_session
 FOREIGN KEY(project_id,session_id) REFERENCES ideation_sessions(project_id,id);
ALTER TABLE ideation_messages ADD CONSTRAINT ideation_message_identity UNIQUE(project_id,session_id,id);
ALTER TABLE ideation_decisions ADD CONSTRAINT ideation_decision_identity UNIQUE(project_id,preview_id,id);
-- Published ranges contain references, never another copy of the user's words.
CREATE TABLE ideation_published_selections (
 preview_id uuid PRIMARY KEY, decision_id uuid NOT NULL, project_id uuid NOT NULL,
 session_id uuid NOT NULL, message_id uuid NOT NULL,
 start_position integer NOT NULL CHECK(start_position>=0),
 end_position integer NOT NULL CHECK(end_position>start_position),
 message_sha256 text NOT NULL CHECK(message_sha256 ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY(project_id,session_id,message_id) REFERENCES ideation_messages(project_id,session_id,id),
 FOREIGN KEY(project_id,preview_id,decision_id) REFERENCES ideation_decisions(project_id,preview_id,id)
);
CREATE INDEX ideation_published_sources ON ideation_published_selections(project_id,session_id,message_id);
CREATE TRIGGER ideation_published_immutable BEFORE UPDATE ON ideation_published_selections
 FOR EACH ROW EXECUTE FUNCTION ruwen_immutable_ideation_decision();
