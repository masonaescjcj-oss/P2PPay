-- Safety against fake accounts that open trades only to collect sellers' payment accounts.
SET search_path TO app, public;

-- Per-offer conditions for the counterparty; require_accept: the seller approves the buyer
-- before the payment account is shown (sell offers).
ALTER TABLE offers ADD COLUMN require_accept boolean NOT NULL DEFAULT false;
ALTER TABLE offers ADD COLUMN min_trades integer NOT NULL DEFAULT 0 CHECK (min_trades BETWEEN 0 AND 1000);
ALTER TABLE offers ADD COLUMN min_account_days integer NOT NULL DEFAULT 0 CHECK (min_account_days BETWEEN 0 AND 3650);
ALTER TABLE offers ADD COLUMN require_id boolean NOT NULL DEFAULT false;

-- accepted_at: when the seller approved (NULL = waiting); revealed_at: when the buyer first saw the account.
ALTER TABLE trades ADD COLUMN accepted_at bigint;
ALTER TABLE trades ADD COLUMN revealed_at bigint;
UPDATE trades SET accepted_at = created_at, revealed_at = created_at;
CREATE INDEX trades_reveal_cancels ON trades (buyer_id, closed_at) WHERE revealed_at IS NOT NULL AND status = 'cancelled';

-- Trading paused (e.g. repeated cancels after seeing accounts) until this time.
ALTER TABLE users ADD COLUMN trade_frozen_until bigint NOT NULL DEFAULT 0;

CREATE TABLE user_blocks (
  blocker_id bigint NOT NULL REFERENCES users(id),
  blocked_id bigint NOT NULL REFERENCES users(id),
  created_at bigint NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked ON user_blocks (blocked_id);

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
