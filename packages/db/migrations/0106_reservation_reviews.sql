CREATE TABLE credit_reservation_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_id uuid NOT NULL UNIQUE REFERENCES credit_reservations,
 actor_id uuid NOT NULL REFERENCES users,
 action text NOT NULL CHECK(action IN ('settle','release')),
 actual_cost_usd numeric CHECK(actual_cost_usd>=0),
 charged_credits bigint NOT NULL CHECK(charged_credits>=0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((action='settle' AND actual_cost_usd IS NOT NULL) OR (action='release' AND actual_cost_usd IS NULL))
);
CREATE TRIGGER reservation_review_append BEFORE UPDATE OR DELETE ON credit_reservation_reviews FOR EACH ROW EXECUTE FUNCTION ruwen_append_only();
CREATE TRIGGER reservation_review_truncate BEFORE TRUNCATE ON credit_reservation_reviews FOR EACH STATEMENT EXECUTE FUNCTION ruwen_append_only();
ALTER TABLE web_admin_audit DROP CONSTRAINT web_admin_audit_action_check;
ALTER TABLE web_admin_audit ADD CHECK(action IN ('dashboard_page','dashboard_data','invitation_create','account_unfreeze','reservation_list','reservation_resolve'));
