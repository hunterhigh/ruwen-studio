CREATE TABLE web_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL CHECK(action IN ('dashboard_page','dashboard_data','invitation_create')),
  outcome text NOT NULL CHECK(outcome IN ('allowed','denied')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_admin_audit_time ON web_admin_audit(created_at DESC);
CREATE FUNCTION ruwen_web_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'web_admin_audit is append only'; END;
$$;
CREATE TRIGGER web_admin_audit_no_rewrite BEFORE UPDATE OR DELETE ON web_admin_audit
FOR EACH ROW EXECUTE FUNCTION ruwen_web_audit_append_only();
