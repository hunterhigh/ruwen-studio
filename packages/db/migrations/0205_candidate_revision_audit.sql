CREATE TABLE candidate_revision_audit (
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  event text NOT NULL DEFAULT 'candidate_user_revision' CHECK (event = 'candidate_user_revision'),
  before_sha256 text NOT NULL CHECK (before_sha256 ~ '^[a-f0-9]{64}$'),
  after_sha256 text NOT NULL CHECK (after_sha256 ~ '^[a-f0-9]{64}$'),
  changed_chars integer NOT NULL CHECK (changed_chars >= 0),
  op text NOT NULL CHECK (op IN ('manual','revert_editor_edits','reapply_editor_edits')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id,version)
);
CREATE TRIGGER candidate_revision_audit_no_rewrite
  BEFORE UPDATE OR DELETE ON candidate_revision_audit
  FOR EACH ROW EXECUTE FUNCTION ruwen_append_only();
CREATE TRIGGER candidate_revision_audit_no_truncate
  BEFORE TRUNCATE ON candidate_revision_audit
  FOR EACH STATEMENT EXECUTE FUNCTION ruwen_append_only();
