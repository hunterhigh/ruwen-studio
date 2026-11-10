CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON credit_ledger FOR EACH STATEMENT EXECUTE FUNCTION ruwen_append_only();
CREATE TRIGGER account_risk_audit_no_truncate BEFORE TRUNCATE ON account_risk_audit FOR EACH STATEMENT EXECUTE FUNCTION ruwen_append_only();
CREATE TRIGGER web_admin_audit_no_truncate BEFORE TRUNCATE ON web_admin_audit FOR EACH STATEMENT EXECUTE FUNCTION ruwen_web_audit_append_only();
