ALTER TABLE credit_ledger ADD COLUMN bank text NOT NULL DEFAULT 'live' CHECK(bank IN ('live','sandbox'));
DROP INDEX credit_ledger_ref;
CREATE UNIQUE INDEX credit_ledger_ref ON credit_ledger(user_id,bank,reason,ref_type,ref_id);
ALTER TABLE credit_reservations ADD COLUMN bank text NOT NULL DEFAULT 'live' CHECK(bank IN ('live','sandbox'));
ALTER TABLE credit_reservations ADD COLUMN remaining bigint NOT NULL DEFAULT 0 CHECK(remaining>=0);
ALTER TABLE credit_reservations ADD COLUMN cost_markup numeric NOT NULL DEFAULT 1 CHECK(cost_markup>0);
ALTER TABLE credit_reservations ADD COLUMN credits_per_usd numeric NOT NULL DEFAULT 1 CHECK(credits_per_usd>0);
CREATE UNIQUE INDEX credit_reservation_run ON credit_reservations(run_id);
CREATE TABLE billing_policy(id boolean PRIMARY KEY DEFAULT true CHECK(id), signup_credits bigint NOT NULL CHECK(signup_credits>=0), risk_threshold integer NOT NULL CHECK(risk_threshold>0));
CREATE TABLE billing_accounts(user_id uuid PRIMARY KEY REFERENCES users, frozen_at timestamptz, frozen_score bigint, reviewed_score bigint NOT NULL DEFAULT 0);
CREATE TABLE account_risk_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users,actor_id uuid REFERENCES users,action text NOT NULL CHECK(action IN ('freeze','unfreeze')),score bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER account_risk_audit_append BEFORE UPDATE OR DELETE ON account_risk_audit FOR EACH ROW EXECUTE FUNCTION ruwen_append_only();
CREATE FUNCTION ruwen_initialize_credits() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO billing_accounts(user_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id)
 SELECT NEW.id,b.bank,p.signup_credits,'signup','user',NEW.id::text FROM billing_policy p CROSS JOIN (VALUES('live'),('sandbox')) b(bank)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER user_initial_credits AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION ruwen_initialize_credits();
ALTER TABLE security_events ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE security_events ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE security_events ALTER COLUMN role_id DROP NOT NULL;
ALTER TABLE security_events DROP CONSTRAINT security_events_kind_check;
ALTER TABLE security_events ADD CHECK(kind IN ('canary','prompt_overlap','internal_refusal','content_refusal','access_denied','rate_limited'));
CREATE FUNCTION ruwen_refresh_risk(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE total bigint; baseline bigint; frozen timestamptz; threshold integer;
BEGIN
 SELECT reviewed_score,frozen_at INTO baseline,frozen FROM billing_accounts WHERE user_id=target FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT risk_threshold INTO threshold FROM billing_policy WHERE id=true;
 SELECT coalesce(sum(score),0) INTO total FROM security_events WHERE user_id=target;
 IF threshold IS NOT NULL AND frozen IS NULL AND total-baseline>=threshold THEN
  UPDATE billing_accounts SET frozen_at=clock_timestamp(),frozen_score=total WHERE user_id=target;
  INSERT INTO account_risk_audit(user_id,action,score) VALUES(target,'freeze',total);
 END IF;
END $$;
CREATE FUNCTION ruwen_security_freeze() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM ruwen_refresh_risk(NEW.user_id); RETURN NEW;
END $$;
CREATE TRIGGER security_event_freeze AFTER INSERT ON security_events FOR EACH ROW EXECUTE FUNCTION ruwen_security_freeze();
CREATE TABLE billing_checkouts(
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users,request_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('mock','lemonsqueezy')),plan_id text NOT NULL,
 credits bigint NOT NULL CHECK(credits>0),price_minor integer NOT NULL CHECK(price_minor>0),currency text NOT NULL CHECK(currency='USD'),
 variant_id text,external_url text,prepared_at timestamptz,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
 order_id text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,request_id),UNIQUE(provider,order_id)
);
ALTER TABLE web_admin_audit DROP CONSTRAINT web_admin_audit_action_check;
ALTER TABLE web_admin_audit ADD CHECK(action IN ('dashboard_page','dashboard_data','invitation_create','account_unfreeze'));
