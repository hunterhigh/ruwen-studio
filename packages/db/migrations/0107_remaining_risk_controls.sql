ALTER TABLE billing_accounts ADD COLUMN daily_credit_limit bigint CHECK(daily_credit_limit>0);
CREATE TABLE account_limit_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users,
 actor_id uuid NOT NULL REFERENCES users,
 previous_limit bigint,
 new_limit bigint,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(user_id=actor_id)
);
CREATE TRIGGER account_limit_audit_append BEFORE UPDATE OR DELETE ON account_limit_audit FOR EACH ROW EXECUTE FUNCTION ruwen_append_only();
CREATE TRIGGER account_limit_audit_no_truncate BEFORE TRUNCATE ON account_limit_audit FOR EACH STATEMENT EXECUTE FUNCTION ruwen_append_only();
CREATE INDEX daily_usage_lookup ON credit_ledger(user_id,bank,created_at) WHERE reason IN ('role_usage','reconciliation');
CREATE INDEX coordinator_turn_window ON pipeline_runs(project_id,(request->>'sessionId'),created_at) WHERE kind='ideation_coordinator';
